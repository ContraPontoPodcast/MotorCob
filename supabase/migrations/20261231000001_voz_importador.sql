-- SQL 64 · Agente de voz: importador das gravações do discador do cliente (a parte humana depois da transferência
-- SIP do agente de IA e as ligações que o operador fez direto pelo discador)
-- Decisão do dono (aprovada): construir o importador que faltava. O Speech Analytics (SQL 60/62) e o worker de
-- transcrição (voz/transcricao/worker.py) já esperavam as gravações em /var/motorcx/importadas; nada as trazia.
-- 1. Fontes por empresa, quantas a empresa quiser (voz_import_config ganha nome, unicidade por (empresa, nome) e as
--    colunas de cada forma). A ferramenta não limita o cliente:
--    a) arquivo  · o cliente envia pelo site (Cargas › Gravações do discador) para o bucket privado
--                  gravacoes-discador, pasta <slug>/<lote>/; o lote fica em voz_import_lotes e os arquivos são
--                  apagados do Storage depois de importados;
--    b) sftp     · o MotorCX lê a pasta do discador (host, porta, usuário, chave pública do servidor fixada e pasta);
--    c) url      · HTTPS: uma URL que devolve o manifesto (lista de gravações com a URL de cada áudio), só nos
--                  domínios autorizados.
--    Credencial SÓ no Secret Manager, pela referência (segredo_ref, como crm_conectores): quem gera a referência e
--    grava o valor é a equipe com gerenciar_troncos_voz (Técnico/Master), por trocar_credencial_fonte_gravacoes. O
--    Admin da empresa (permissão nova importar_gravacoes) cadastra e edita as fontes; ligar a transcrição continua
--    com a equipe, porque tem custo por minuto (como na tela aprovada).
-- 2. Manifesto (CSV ou JSON) validado com rigor na VM (voz/importador/manifesto.py): id_chamada do discador, início,
--    duração, operador_ref, id_cliente/id_acao (só códigos), carteira (código), arquivo ou url e, quando houver,
--    id_chamada_motorcx (o cabeçalho X-MotorCX-Id-Chamada da transferência). Coluna de CPF, nome, telefone ou
--    e-mail recusa o arquivo; linha com padrão de dado pessoal vai para a quarentena. Erro por arquivo em
--    voz_import_arquivos (o registro da importação) e por linha em voz_import_quarentena (motivos novos).
-- 3. Par com a chamada do MotorCX (preparar_importacao_voz): pelo id da transferência e, sem ele, pela janela de
--    tempo da transferência atendida (janela_par_s, padrão 120 s) com o cliente/ação/carteira que vierem. Um par só =
--    casada (voz_gravacoes.chamada_id = a chamada da IA: a análise liga a parte da IA e a do operador); mais de um =
--    par_ambiguo; nenhum = sem_par. Nunca no palpite. Sem par: quarentena, ou "avulsa" (só com id_cliente) quando
--    a fonte desliga so_transferencias. Reimportar não duplica: chave_importacao (hash do id_chamada, só letras) é
--    única por empresa; reimportar uma avulsa que agora tem par só liga a chamada.
-- 4. A VM sobe o áudio para o bucket da empresa (voz_config.bucket_gravacoes) em discador/<AAAA>/<MM>/<DD>/<chave>.<ext>,
--    grava voz_gravacoes origem = 'discador' com operador_ref (registrar_importacao_voz; validade pela retenção da
--    empresa, mínimo 90 dias, como toda gravação) e, com a transcrição ligada, deixa o áudio para o Whisper da VM
--    (<id da gravação>.<ext>, o ref que o Speech Analytics já casa). O worker devolve a situação
--    (registrar_transcricao_voz): voz_gravacoes.transcricao e, na 1ª vez que dá certo, os minutos no item
--    voz_transcricao pelo registrar_consumo_ia (SQL 61: custo para a margem + quantidade da fatura).
-- 5. Agendador: timer da VM (motorcx-voz-importador.timer), desligado por padrão em dois lugares: metadado
--    motorcx-importador-gravacoes=1 na VM e, por fonte, leitura_automatica (padrão false). "Ler agora" (pedido) e o
--    envio pelo site rodam no mesmo timer.
-- 6. Os dois acessos da VM (SQL 57): as RPCs do public aceitam o servidor e a VM; o papel motorcx_voz chama as
--    funções de voz_vm (mesmos argumentos num objeto jsonb). Arquivos do envio pelo site: bilhete do SQL 57 para o
--    bucket gravacoes-discador (baixar enquanto o lote está pendente; apagar depois de concluído).
-- LGPD: nada aqui guarda CPF, nome, telefone ou e-mail. id_chamada do discador vira hash; a referência mostrada só
-- aparece quando não tem sequência de 10+ dígitos. Nome de arquivo com dado pessoal é descartado.
-- Depende dos SQL 56, 57, 58, 60, 61 e 62. Pode rodar de novo sem erro. Se o SQL 56, 57, 58 ou 60 for rodado de
-- novo, rode este depois (ele refaz as trocas em voz_vm.empresa_do_caminho, no bilhete e no catálogo).
--
-- Conferência (no SQL Editor do Supabase, depois de rodar):
--   select (select count(*) from pg_tables where schemaname = 'public'
--             and tablename in ('voz_import_arquivos', 'voz_import_lotes') and rowsecurity) as tabelas_com_rls,   -- 2
--          (select count(*) from public.permissoes_catalogo where codigo = 'importar_gravacoes') as permissao,     -- 1
--          (select public from storage.buckets where id = 'gravacoes-discador') as bucket_publico,                -- false
--          (select column_default from information_schema.columns where table_name = 'voz_import_config'
--             and column_name = 'leitura_automatica') as leitura_automatica_padrao,                                -- false
--          has_function_privilege('motorcx_voz', 'voz_vm.registrar_importacao(jsonb)', 'execute')
--            and not has_table_privilege('motorcx_voz', 'public.voz_gravacoes', 'insert') as vm_importa,           -- true
--          has_function_privilege('authenticated', 'public.registrar_importacao_voz(bigint, jsonb)', 'execute') as site_grava, -- false
--          has_table_privilege('authenticated', 'public.voz_import_arquivos', 'insert') as site_insere;           -- false

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

-- ================================================================ 1. permissão nova do cliente (catálogo)
-- O catálogo é uma view de valores que outros SQL recriam inteira: aqui só ACRESCENTA a linha, se ainda não está,
-- por cima do que estiver lá (assim um SQL vizinho que também acrescente não perde a dele).
do $$
declare
    def text;
    prox int;
begin
    if not exists (select 1 from public.permissoes_catalogo where codigo = 'importar_gravacoes') then
        def := rtrim(btrim(pg_get_viewdef('public.permissoes_catalogo'::regclass)), ';');
        prox := coalesce((select max(ordem) from public.permissoes_catalogo), 0) + 1;
        execute format('create or replace view public.permissoes_catalogo as %s union all select %L::text, %L::text, '
                       '%L::text, %L::text, true, false, false, false, %s', def, 'importar_gravacoes', 'Agente virtual',
                       'Importar gravações do discador',
                       'Fontes das gravações do discador (envio pelo site, SFTP, HTTPS), leitura agora e registro.', prox);
    end if;
end $$;
grant select on public.permissoes_catalogo to authenticated;
revoke all on public.permissoes_catalogo from anon;

-- ================================================================ 2. fontes (voz_import_config)
alter table public.voz_import_config add column if not exists nome text;
update public.voz_import_config set nome = left(adaptador || ' · ' || forma, 60) where nome is null;
create or replace function public.nome_fonte_gravacoes() returns trigger
language plpgsql set search_path = public as $$
begin
    if new.nome is null or btrim(new.nome) = '' then
        new.nome := left(new.adaptador || ' · ' || new.forma, 60);     -- salvar_importacao_voz (SQL 56) não manda nome
    end if;
    new.nome := btrim(new.nome);
    return new;
end $$;
revoke all on function public.nome_fonte_gravacoes() from public, anon, authenticated;
drop trigger if exists a_nome_fonte_gravacoes on public.voz_import_config;
create trigger a_nome_fonte_gravacoes before insert or update on public.voz_import_config
    for each row execute function public.nome_fonte_gravacoes();
alter table public.voz_import_config alter column nome set not null;

alter table public.voz_import_config
    add column if not exists host               text,
    add column if not exists porta              int not null default 22,
    add column if not exists usuario            text,
    add column if not exists chave_host         text,
    add column if not exists url_lista          text,
    add column if not exists leitura_automatica boolean not null default false,
    add column if not exists intervalo_horas    int not null default 24,
    add column if not exists so_transferencias  boolean not null default true,
    add column if not exists janela_par_s       int not null default 120,
    add column if not exists dias_busca         int not null default 7,
    add column if not exists pedido_em          timestamptz,
    add column if not exists pedido_por         uuid references auth.users (id) on delete set null,
    add column if not exists reprocessar        boolean not null default false,
    add column if not exists ultima_leitura_em  timestamptz,
    add column if not exists credencial_trocada_em timestamptz,
    add column if not exists atualizado_em      timestamptz not null default now(),
    add column if not exists atualizado_por     uuid references auth.users (id) on delete set null;

-- checks nomeados (refeitos a cada rodada)
alter table public.voz_import_config drop constraint if exists voz_import_fonte_nome_ok;
alter table public.voz_import_config add constraint voz_import_fonte_nome_ok
    check (char_length(nome) between 2 and 60 and nome !~ '[0-9]{8,}' and nome !~ '@' and nome !~ '[<>{}]');
alter table public.voz_import_config drop constraint if exists voz_import_fonte_host_ok;
alter table public.voz_import_config add constraint voz_import_fonte_host_ok
    check (host is null or (host ~ '^[A-Za-z0-9][A-Za-z0-9.\-]{1,252}$' and host !~ '\.\.'));
alter table public.voz_import_config drop constraint if exists voz_import_fonte_porta_ok;
alter table public.voz_import_config add constraint voz_import_fonte_porta_ok check (porta between 1 and 65535);
alter table public.voz_import_config drop constraint if exists voz_import_fonte_usuario_ok;
alter table public.voz_import_config add constraint voz_import_fonte_usuario_ok
    check (usuario is null or (usuario ~ '^[A-Za-z0-9_.\-]{1,64}$' and usuario !~ '[0-9]{8,}'));
alter table public.voz_import_config drop constraint if exists voz_import_fonte_chave_host_ok;
alter table public.voz_import_config add constraint voz_import_fonte_chave_host_ok
    check (chave_host is null or (char_length(chave_host) <= 1500
           and chave_host ~ '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521) [A-Za-z0-9+/]{40,}={0,2}$'));
alter table public.voz_import_config drop constraint if exists voz_import_fonte_url_ok;
alter table public.voz_import_config add constraint voz_import_fonte_url_ok
    check (url_lista is null or (char_length(url_lista) <= 500
                                 and url_lista ~ '^https://[a-z0-9][a-z0-9.\-]{1,252}(:[0-9]{2,5})?(/[A-Za-z0-9_\-./~%?=&+]*)?$'
                                 and url_lista !~ '[0-9]{10,}' and url_lista !~ '@'));
alter table public.voz_import_config drop constraint if exists voz_import_fonte_pasta_ok;
alter table public.voz_import_config add constraint voz_import_fonte_pasta_ok
    check (pasta is null or (pasta !~ '\.\.' and pasta !~ '[0-9]{10,}'));
alter table public.voz_import_config drop constraint if exists voz_import_fonte_numeros_ok;
alter table public.voz_import_config add constraint voz_import_fonte_numeros_ok
    check (intervalo_horas between 1 and 24 and janela_par_s between 10 and 900 and dias_busca between 1 and 30);
-- a credencial: o check do SQL 56 exigia segredo_ref fora do arquivo. Agora: SFTP só fica ativo com a credencial;
-- HTTPS pode não ter (lista pública assinada); arquivo nunca tem.
do $$
declare c record;
begin
    for c in select conname from pg_constraint
              where conrelid = 'public.voz_import_config'::regclass and contype = 'c'
                and conname not like 'voz_import_fonte_%'
                and pg_get_constraintdef(oid) like '%segredo_ref IS NOT NULL%' loop
        execute format('alter table public.voz_import_config drop constraint %I', c.conname);
    end loop;
end $$;
alter table public.voz_import_config drop constraint if exists voz_import_fonte_credencial;
alter table public.voz_import_config add constraint voz_import_fonte_credencial
    check (not ativo or forma <> 'sftp' or segredo_ref is not null);

-- várias fontes por empresa: a unicidade passa a ser pelo nome. A restrição de nome antigo continua existindo
-- (salvar_importacao_voz do SQL 56 faz "on conflict on constraint" nela), agora com o nome junto.
do $$
begin
    if exists (select 1 from pg_constraint where conname = 'voz_import_config_empresa_id_adaptador_key'
                  and conrelid = 'public.voz_import_config'::regclass and array_length(conkey, 1) = 2) then
        alter table public.voz_import_config drop constraint voz_import_config_empresa_id_adaptador_key;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'voz_import_config_empresa_id_adaptador_key'
                      and conrelid = 'public.voz_import_config'::regclass) then
        alter table public.voz_import_config add constraint voz_import_config_empresa_id_adaptador_key
            unique (empresa_id, adaptador, nome);
    end if;
end $$;
create unique index if not exists voz_import_config_nome on public.voz_import_config (empresa_id, lower(nome));
comment on column public.voz_import_config.nome is 'Nome da fonte na tela (único na empresa). Sem telefone, CPF ou e-mail.';
comment on column public.voz_import_config.segredo_ref is
    'Só o NOME do segredo no Secret Manager (voz/importador/<empresa>/<fonte>/<versão>). Senha ou chave SSH; token Bearer no HTTPS.';
comment on column public.voz_import_config.chave_host is
    'Chave pública do servidor SFTP ("ssh-ed25519 AAAA..."), fixada: servidor com outra chave é recusado.';
comment on column public.voz_import_config.url_lista is 'HTTPS que devolve o manifesto (JSON ou CSV) com a URL de cada áudio.';
comment on column public.voz_import_config.leitura_automatica is
    'Leitura pelo timer da VM a cada intervalo_horas (padrão desligado; a VM também precisa do metadado motorcx-importador-gravacoes=1).';
comment on column public.voz_import_config.so_transferencias is
    'true (padrão): só entra gravação com par numa transferência do agente de IA; o resto vai para a quarentena (sem_par).';
comment on column public.voz_import_config.janela_par_s is 'Diferença máxima entre o início da gravação e a transferência (par pela janela).';

-- ================================================================ 3. execuções, arquivos, lotes e quarentena
alter table public.voz_import_execucoes
    add column if not exists origem      text not null default 'agendada',
    add column if not exists arquivos    int not null default 0,
    add column if not exists importadas  int not null default 0,
    add column if not exists duplicadas  int not null default 0,
    add column if not exists minutos     numeric(10, 1) not null default 0;
alter table public.voz_import_execucoes drop constraint if exists voz_import_execucoes_origem_ok;
alter table public.voz_import_execucoes add constraint voz_import_execucoes_origem_ok
    check (origem in ('agendada', 'pedido', 'envio')
           and least(arquivos, importadas, duplicadas) >= 0 and minutos >= 0);
create index if not exists voz_import_execucoes_empresa on public.voz_import_execucoes (empresa_id, iniciada_em desc);
alter table public.voz_import_execucoes drop constraint if exists voz_import_execucoes_erro_ok;
alter table public.voz_import_execucoes add constraint voz_import_execucoes_erro_ok
    check (erro is null or (erro !~ '[0-9]{10,}' and erro !~ '@'));

create table if not exists public.voz_import_lotes (
    id           bigint generated always as identity primary key,
    empresa_id   bigint not null references public.empresas (id) on delete cascade,
    config_id    bigint not null references public.voz_import_config (id) on delete cascade,
    pasta        text not null check (pasta ~ '^[a-z0-9][a-z0-9-]{1,39}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    arquivos     jsonb not null check (jsonb_typeof(arquivos) = 'array' and jsonb_array_length(arquivos) between 1 and 2000),
    situacao     text not null default 'pendente' check (situacao in ('pendente', 'processando', 'concluido', 'erro')),
    execucao_id  bigint references public.voz_import_execucoes (id) on delete set null,
    enviado_por  uuid default auth.uid() references auth.users (id) on delete set null,
    enviado_em   timestamptz not null default now(),
    apagado_em   timestamptz,
    unique (pasta)
);
create index if not exists voz_import_lotes_situacao on public.voz_import_lotes (situacao) where apagado_em is null;
comment on table public.voz_import_lotes is
    'Envio de gravações pelo site (bucket gravacoes-discador, <slug>/<lote>/<n>.<ext>). arquivos: [{caminho, nome_hash, tamanho}]: '
    'o nome original nunca é guardado, só o sha-256 dele (minúsculo), que casa com a coluna arquivo do manifesto.';

create table if not exists public.voz_import_arquivos (
    id           bigint generated always as identity primary key,
    empresa_id   bigint not null references public.empresas (id) on delete cascade,
    config_id    bigint not null references public.voz_import_config (id) on delete cascade,
    execucao_id  bigint not null references public.voz_import_execucoes (id) on delete cascade,
    nome         text not null check (char_length(nome) between 1 and 120 and nome !~ '[0-9]{10,}' and nome !~ '@'),
    assinatura   text not null check (assinatura ~ '^[0-9a-f]{64}$'),
    linhas       int not null default 0 check (linhas >= 0),
    importadas   int not null default 0 check (importadas >= 0),
    casadas      int not null default 0 check (casadas >= 0),
    duplicadas   int not null default 0 check (duplicadas >= 0),
    rejeitadas   int not null default 0 check (rejeitadas >= 0),
    sem_operador int not null default 0 check (sem_operador >= 0),
    minutos      numeric(10, 1) not null default 0 check (minutos >= 0),
    erro         text check (erro is null or (char_length(erro) <= 300 and erro !~ '[0-9]{10,}' and erro !~ '@')),
    repetir      boolean not null default false,
    motivos      jsonb not null default '{}' check (jsonb_typeof(motivos) = 'object'),
    criado_em    timestamptz not null default now()
);
create index if not exists voz_import_arquivos_exec on public.voz_import_arquivos (execucao_id);
create index if not exists voz_import_arquivos_lidos on public.voz_import_arquivos (config_id, assinatura) where not repetir;
comment on table public.voz_import_arquivos is
    'Registro da importação por arquivo (manifesto): linhas, importadas, casadas, duplicadas, rejeitadas e os motivos. '
    'nome: o do arquivo quando não tem dado pessoal; senão "[nome descartado]". repetir: erro passageiro (lê de novo).';

alter table public.voz_import_quarentena
    add column if not exists arquivo_id bigint references public.voz_import_arquivos (id) on delete cascade,
    add column if not exists linha      int,
    add column if not exists detalhe    text;
alter table public.voz_import_quarentena drop constraint if exists voz_import_quarentena_motivo_check;
alter table public.voz_import_quarentena add constraint voz_import_quarentena_motivo_check
    check (motivo in ('sem_par', 'par_ambiguo', 'nome_com_dado_pessoal', 'formato', 'outro',
                      -- SQL 64
                      'dado_pessoal', 'campo_invalido', 'carteira_desconhecida', 'audio_ausente', 'audio_invalido',
                      'grande_demais', 'url_nao_permitida', 'download', 'duplicada_no_arquivo', 'par_conflitante',
                      'chamada_com_gravacao', 'sem_cliente'));
alter table public.voz_import_quarentena drop constraint if exists voz_import_quarentena_detalhe_ok;
alter table public.voz_import_quarentena add constraint voz_import_quarentena_detalhe_ok
    check ((linha is null or linha between 1 and 1000000)
           and (detalhe is null or (char_length(detalhe) <= 120 and detalhe !~ '[0-9]{8,}' and detalhe !~ '@')));
create index if not exists voz_import_quarentena_empresa on public.voz_import_quarentena (empresa_id, criado_em desc);

-- ================================================================ 4. voz_gravacoes: chave da importação e transcrição
alter table public.voz_gravacoes
    add column if not exists chave_importacao    text,
    add column if not exists fonte_id            bigint references public.voz_import_config (id) on delete set null,
    add column if not exists transcricao         text,
    add column if not exists transcrita_em       timestamptz,
    add column if not exists minutos_transcritos numeric(8, 2);
alter table public.voz_gravacoes drop constraint if exists voz_gravacoes_importacao_ok;
alter table public.voz_gravacoes add constraint voz_gravacoes_importacao_ok
    check ((chave_importacao is null or (chave_importacao ~ '^[a-p]{24}$' and origem = 'discador'))
           and (transcricao is null or transcricao in ('pendente', 'ok', 'abaixo_limiar', 'desligada', 'erro'))
           and (minutos_transcritos is null or minutos_transcritos between 0 and 1000));
create unique index if not exists voz_gravacoes_chave_importacao on public.voz_gravacoes (empresa_id, chave_importacao)
    where chave_importacao is not null;
create index if not exists voz_chamadas_transferida on public.voz_chamadas (empresa_id, transferida_em)
    where transferida_em is not null;
comment on column public.voz_gravacoes.chave_importacao is
    'Importador (SQL 64): sha-256 de empresa:id_chamada do discador em 24 letras a–p (sem dígito). Reimportar não duplica.';
comment on column public.voz_gravacoes.transcricao is 'Situação da transcrição da gravação importada (worker Whisper da VM).';

-- ================================================================ 5. RLS das tabelas novas
alter table public.voz_import_lotes enable row level security;
alter table public.voz_import_arquivos enable row level security;
drop policy if exists voz_import_lotes_ver on public.voz_import_lotes;
create policy voz_import_lotes_ver on public.voz_import_lotes for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists voz_import_arquivos_ver on public.voz_import_arquivos;
create policy voz_import_arquivos_ver on public.voz_import_arquivos for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_import_lotes, public.voz_import_arquivos from anon;
revoke insert, update, delete on public.voz_import_lotes, public.voz_import_arquivos from authenticated;
grant all on public.voz_import_lotes, public.voz_import_arquivos to service_role;
drop trigger if exists z_auditar on public.voz_import_config;
create trigger z_auditar after insert or update or delete on public.voz_import_config
    for each row execute function public.auditar();

-- ================================================================ 6. bucket do envio pelo site
insert into storage.buckets (id, name, public) values ('gravacoes-discador', 'gravacoes-discador', false)
    on conflict (id) do update set public = false;
do $$
begin
    if exists (select 1 from information_schema.columns
               where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
        execute $u$update storage.buckets set file_size_limit = 209715200,
                   allowed_mime_types = array['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave', 'audio/mpeg',
                     'audio/mp3', 'audio/ogg', 'audio/opus', 'audio/flac', 'audio/x-flac', 'audio/mp4', 'audio/x-m4a',
                     'audio/m4a', 'text/csv', 'text/plain', 'application/json', 'application/zip',
                     'application/x-zip-compressed', 'application/octet-stream'] where id = 'gravacoes-discador'$u$;
    end if;
end $$;
-- o cliente só ENVIA (nunca lista nem lê de volta): a pasta é da empresa dele, com a permissão de enviar arquivos
drop policy if exists gravacoes_discador_enviar on storage.objects;
create policy gravacoes_discador_enviar on storage.objects for insert to authenticated
    with check (bucket_id = 'gravacoes-discador' and public.pode('enviar_arquivos')
                and public.pode_ver_slug((storage.foldername(name))[1])
                and name ~ '^[a-z0-9][a-z0-9-]{1,39}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{1,4}\.(wav|mp3|ogg|opus|flac|m4a|csv|json|zip)$');

-- ================================================================ 7. RPCs do site
-- quem edita as fontes: o Admin da empresa (importar_gravacoes) ou a equipe com gerenciar_troncos_voz no alcance
create or replace function public.edita_fontes_gravacoes(eid bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select (not public.sou_equipe() and eid in (select public.minhas_empresas()) and public.pode('importar_gravacoes'))
        or public.cuida_voz(eid)
$$;
revoke all on function public.edita_fontes_gravacoes(bigint) from public, anon;
grant execute on function public.edita_fontes_gravacoes(bigint) to authenticated;

create or replace function public.salvar_fonte_gravacoes(empresa bigint, fonte bigint, dados jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
    f public.voz_import_config;
    fora text;
    equipe boolean := public.cuida_voz(empresa);
    v_forma text;
    v_host text; v_usuario text; v_chave text; v_pasta text; v_url text; v_dom text[];
    v_segredo text;
    v_ativo boolean;
    fid bigint;
begin
    if not public.edita_fontes_gravacoes(empresa) then
        raise exception 'só o Admin da empresa (ou a equipe MotorCX) configura as fontes de gravação';
    end if;
    if jsonb_typeof(dados) is distinct from 'object' then
        raise exception 'dados: um objeto';
    end if;
    select string_agg(k, ', ' order by k) into fora from jsonb_object_keys(dados) k
     where k <> all (array['nome', 'adaptador', 'forma', 'host', 'porta', 'usuario', 'chave_host', 'pasta', 'url_lista',
                           'dominios_url', 'leitura_automatica', 'intervalo_horas', 'so_transferencias', 'janela_par_s',
                           'dias_busca', 'ativo', 'transcrever']);
    if fora is not null then
        raise exception 'campo que a fonte não aceita: % (a credencial vai só para o cofre)', fora;
    end if;
    if dados ? 'transcrever' and not equipe then
        raise exception 'ligar ou desligar a transcrição é pedido à equipe MotorCX (tem custo por minuto)';
    end if;
    if fonte is not null then
        select * into f from public.voz_import_config x where x.id = fonte and x.empresa_id = empresa for update;
        if f.id is null then
            raise exception 'fonte não encontrada';
        end if;
    end if;
    v_forma := coalesce(dados ->> 'forma', f.forma);
    if v_forma is null or v_forma not in ('arquivo', 'sftp', 'url') and (fonte is null or v_forma <> f.forma) then
        raise exception 'forma: arquivo (envio pelo site), sftp ou url (HTTPS)';
    end if;
    v_host := lower(nullif(btrim(coalesce(dados ->> 'host', f.host, '')), ''));
    v_usuario := nullif(btrim(coalesce(dados ->> 'usuario', f.usuario, '')), '');
    v_chave := nullif(btrim(coalesce(dados ->> 'chave_host', f.chave_host, '')), '');
    v_pasta := nullif(btrim(coalesce(dados ->> 'pasta', f.pasta, '')), '');
    v_url := nullif(btrim(coalesce(dados ->> 'url_lista', f.url_lista, '')), '');
    v_dom := case when dados ? 'dominios_url'
                  then array(select distinct lower(btrim(x)) from jsonb_array_elements_text(dados -> 'dominios_url') x
                              where btrim(x) <> '' order by 1)
                  else coalesce(f.dominios_url, '{}') end;
    if v_forma = 'sftp' and (v_host is null or v_usuario is null or v_chave is null or v_pasta is null) then
        raise exception 'SFTP: informe servidor, usuário, chave pública do servidor e pasta';
    end if;
    if v_forma = 'sftp' and (v_host ~ '^(10|127|0)\.' or v_host ~ '^192\.168\.' or v_host ~ '^169\.254\.'
                             or v_host ~ '^172\.(1[6-9]|2[0-9]|3[01])\.' or v_host in ('localhost', 'metadata.google.internal')) then
        raise exception 'SFTP: servidor em rede interna não é aceito';
    end if;
    if v_forma = 'url' then
        if v_url is null then
            raise exception 'HTTPS: informe a URL da lista de gravações';
        end if;
        v_dom := array(select distinct x from unnest(v_dom || substring(v_url from '^https://([^/:]+)')) x order by 1);
        if cardinality(v_dom) > 10 then
            raise exception 'até 10 domínios autorizados';
        end if;
    end if;
    if v_forma <> 'sftp' then
        v_host := null; v_usuario := null; v_chave := null;
    end if;
    if v_forma <> 'url' then
        v_url := null;
    end if;
    if v_forma = 'arquivo' then
        v_pasta := null;
    end if;
    -- trocou a forma, o servidor, o usuário ou a URL: a credencial antiga não vale mais (pede de novo à equipe)
    v_segredo := case when fonte is null or v_forma = 'arquivo'
                           or (v_forma, v_host, v_usuario, v_url) is distinct from (f.forma, f.host, f.usuario, f.url_lista)
                      then null else f.segredo_ref end;
    v_ativo := coalesce((dados ->> 'ativo')::boolean, f.ativo, true);
    if v_forma = 'sftp' and v_ativo and v_segredo is null then
        if dados ? 'ativo' and (dados ->> 'ativo')::boolean then
            raise exception 'o SFTP só fica ativo depois que a equipe MotorCX grava a credencial no cofre';
        end if;
        v_ativo := false;
    end if;
    begin
        if fonte is null then
            insert into public.voz_import_config as x (empresa_id, nome, adaptador, forma, host, porta, usuario,
                    chave_host, pasta, url_lista, dominios_url, leitura_automatica, intervalo_horas, so_transferencias,
                    janela_par_s, dias_busca, ativo, transcrever, atualizado_por)
            values (empresa, dados ->> 'nome', coalesce(dados ->> 'adaptador', 'generico'), v_forma, v_host,
                    coalesce((dados ->> 'porta')::int, 22), v_usuario, v_chave, v_pasta, v_url, v_dom,
                    coalesce((dados ->> 'leitura_automatica')::boolean, false), coalesce((dados ->> 'intervalo_horas')::int, 24),
                    coalesce((dados ->> 'so_transferencias')::boolean, true), coalesce((dados ->> 'janela_par_s')::int, 120),
                    coalesce((dados ->> 'dias_busca')::int, 7),
                    v_ativo,      -- SFTP nasce pausado: só fica ativo depois que a equipe grava a credencial no cofre
                    coalesce((dados ->> 'transcrever')::boolean, false), auth.uid())
            returning x.id into fid;
        else
            update public.voz_import_config x set
                nome = coalesce(dados ->> 'nome', x.nome),
                adaptador = coalesce(dados ->> 'adaptador', x.adaptador),
                forma = v_forma, host = v_host, usuario = v_usuario, chave_host = v_chave, pasta = v_pasta,
                url_lista = v_url, dominios_url = v_dom,
                porta = coalesce((dados ->> 'porta')::int, x.porta),
                leitura_automatica = coalesce((dados ->> 'leitura_automatica')::boolean, x.leitura_automatica),
                intervalo_horas = coalesce((dados ->> 'intervalo_horas')::int, x.intervalo_horas),
                so_transferencias = coalesce((dados ->> 'so_transferencias')::boolean, x.so_transferencias),
                janela_par_s = coalesce((dados ->> 'janela_par_s')::int, x.janela_par_s),
                dias_busca = coalesce((dados ->> 'dias_busca')::int, x.dias_busca),
                ativo = v_ativo,
                transcrever = coalesce((dados ->> 'transcrever')::boolean, x.transcrever),
                segredo_ref = v_segredo,
                atualizado_em = now(), atualizado_por = auth.uid()
             where x.id = fonte
            returning x.id into fid;
        end if;
    exception
        when unique_violation then
            raise exception 'já existe uma fonte com esse nome nesta empresa';
        when check_violation then
            raise exception 'dados da fonte inválidos (nome sem telefone/CPF/e-mail, servidor, usuário, chave pública, URL só HTTPS ou números fora do limite)';
        when invalid_text_representation then
            raise exception 'número ou sim/não inválido nos dados da fonte';
    end;
    return fid;
end $$;
revoke all on function public.salvar_fonte_gravacoes(bigint, bigint, jsonb) from public, anon;
grant execute on function public.salvar_fonte_gravacoes(bigint, bigint, jsonb) to authenticated;

-- nome novo de segredo no cofre para a fonte (a ferramenta da equipe grava o valor direto no Secret Manager; o banco
-- nunca vê a credencial). Só a equipe; SFTP volta a ficar pausado até a próxima leitura dar certo é decisão da equipe.
create or replace function public.trocar_credencial_fonte_gravacoes(fonte bigint) returns text
language plpgsql security definer set search_path = public as $$
declare
    f public.voz_import_config;
    ref text;
begin
    select * into f from public.voz_import_config where id = fonte for update;
    if f.id is null or not public.cuida_voz(f.empresa_id) then
        raise exception 'só a equipe MotorCX com gerenciar_troncos_voz grava a credencial no cofre';
    end if;
    if f.forma = 'arquivo' then
        raise exception 'o envio pelo site não tem credencial';
    end if;
    ref := format('voz/importador/%s/%s/%s', f.empresa_id, f.id,
                  to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISS'));
    update public.voz_import_config x set segredo_ref = ref, credencial_trocada_em = now(), atualizado_em = now(),
           atualizado_por = auth.uid()
     where x.id = fonte;
    return ref;
end $$;
revoke all on function public.trocar_credencial_fonte_gravacoes(bigint) from public, anon;
grant execute on function public.trocar_credencial_fonte_gravacoes(bigint) to authenticated;

-- "Ler agora" (e "Ler de novo", que relê os arquivos já lidos): a VM pega no próximo ciclo do timer
create or replace function public.pedir_leitura_gravacoes(fonte bigint, reprocessar boolean default false) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare f public.voz_import_config;
begin
    select * into f from public.voz_import_config where id = fonte for update;
    if f.id is null or not public.edita_fontes_gravacoes(f.empresa_id) then
        raise exception 'só o Admin da empresa (ou a equipe MotorCX) pede a leitura';
    end if;
    if not f.ativo then
        raise exception 'a fonte está pausada';
    end if;
    if f.forma = 'arquivo' then
        raise exception 'o envio pelo site é lido sozinho depois do envio';
    end if;
    update public.voz_import_config x set pedido_em = now(), pedido_por = auth.uid(),
           reprocessar = coalesce(pedir_leitura_gravacoes.reprocessar, false)
     where x.id = fonte;
    return now();
end $$;
revoke all on function public.pedir_leitura_gravacoes(bigint, boolean) from public, anon;
grant execute on function public.pedir_leitura_gravacoes(bigint, boolean) to authenticated;

-- envio pelo site: os arquivos já estão no bucket (o site sobe com a política do bucket); aqui vira um lote
create or replace function public.registrar_envio_gravacoes(empresa bigint, arquivos jsonb, fonte bigint default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
    s text := (select e.slug from public.empresas e where e.id = empresa);
    p text;
    fid bigint := fonte;
    lid bigint;
begin
    if not ((not public.sou_equipe() and empresa in (select public.minhas_empresas()) and public.pode('enviar_arquivos'))
            or public.cuida_voz(empresa)) then
        raise exception 'sem permissão para enviar gravações desta empresa';
    end if;
    if not exists (select 1 from public.voz_config c where c.empresa_id = empresa) then
        raise exception 'a empresa ainda não tem o agente de voz configurado';
    end if;
    if jsonb_typeof(arquivos) is distinct from 'array' or jsonb_array_length(arquivos) not between 1 and 2000
       or exists (select 1 from jsonb_array_elements(arquivos) a
                   where jsonb_typeof(a) <> 'object'
                      or (select count(*) from jsonb_object_keys(a)) <> 3
                      or coalesce(a ->> 'caminho', '') !~ ('^' || s || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{1,4}\.(wav|mp3|ogg|opus|flac|m4a|csv|json|zip)$')
                      or coalesce(a ->> 'nome_hash', '') !~ '^[0-9a-f]{64}$'
                      or coalesce(a ->> 'tamanho', '') !~ '^[0-9]{1,10}$') then
        raise exception 'arquivos: lista de {caminho, nome_hash, tamanho} na pasta da empresa';
    end if;
    select min(regexp_replace(a ->> 'caminho', '/[^/]+$', '')) into p from jsonb_array_elements(arquivos) a;
    if exists (select 1 from jsonb_array_elements(arquivos) a where regexp_replace(a ->> 'caminho', '/[^/]+$', '') <> p)
       or (select count(distinct a ->> 'caminho') from jsonb_array_elements(arquivos) a) <> jsonb_array_length(arquivos) then
        raise exception 'o lote é uma pasta só, sem arquivo repetido';
    end if;
    if not exists (select 1 from jsonb_array_elements(arquivos) a where a ->> 'caminho' ~ '\.(csv|json|zip)$') then
        raise exception 'o lote precisa do manifesto (CSV ou JSON) ou de um zip com ele';
    end if;
    if exists (select 1 from jsonb_array_elements(arquivos) a
                where not exists (select 1 from storage.objects o where o.bucket_id = 'gravacoes-discador'
                                                                    and o.name = a ->> 'caminho')) then
        raise exception 'arquivo do lote não está no bucket';
    end if;
    if fid is null then
        select x.id into fid from public.voz_import_config x
         where x.empresa_id = empresa and x.forma = 'arquivo' and x.ativo order by x.id limit 1;
        if fid is null then
            insert into public.voz_import_config (empresa_id, nome, adaptador, forma, ativo)
            values (empresa, 'Envio pelo site', 'generico', 'arquivo', true)
            on conflict do nothing
            returning id into fid;
            if fid is null then
                raise exception 'a fonte "Envio pelo site" existe e está pausada';
            end if;
        end if;
    elsif not exists (select 1 from public.voz_import_config x where x.id = fid and x.empresa_id = empresa
                                                              and x.forma = 'arquivo' and x.ativo) then
        raise exception 'fonte de envio pelo site não encontrada ou pausada';
    end if;
    insert into public.voz_import_lotes (empresa_id, config_id, pasta, arquivos)
    values (empresa, fid, p, arquivos)
    returning id into lid;
    return lid;
exception
    when unique_violation then
        raise exception 'este lote já foi registrado';
end $$;
revoke all on function public.registrar_envio_gravacoes(bigint, jsonb, bigint) from public, anon;
grant execute on function public.registrar_envio_gravacoes(bigint, jsonb, bigint) to authenticated;

-- ================================================================ 8. RPCs da VM (servidor ou motorcx_voz)
create or replace function public.vm_ou_servidor_importa() returns void
language plpgsql stable security definer set search_path = public as $$
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só a VM de voz (ou o servidor) importa gravações';
    end if;
end $$;
revoke all on function public.vm_ou_servidor_importa() from public, anon, authenticated;
grant execute on function public.vm_ou_servidor_importa() to service_role;

-- o que esta VM tem para ler agora: fontes com pedido, leitura automática vencida ou lote pendente (empresas da parte
-- i/n, como o resto da voz). Sem segredo: só a referência. Também os lotes concluídos que faltam apagar do Storage.
create or replace function public.importacao_voz_pendente(parte text default '1/1') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    i int;
    n int;
begin
    perform public.vm_ou_servidor_importa();
    if coalesce(parte, '1/1') !~ '^[1-9][0-9]?/[1-9][0-9]?$' then
        raise exception 'parte: i/n';
    end if;
    i := split_part(coalesce(parte, '1/1'), '/', 1)::int;
    n := split_part(coalesce(parte, '1/1'), '/', 2)::int;
    if i > n then
        raise exception 'parte: i/n com i <= n';
    end if;
    return jsonb_build_object(
        'fontes', coalesce((
            select jsonb_agg(jsonb_build_object(
                'fonte_id', f.id, 'empresa_id', f.empresa_id, 'slug', e.slug, 'nome', f.nome, 'adaptador', f.adaptador,
                'forma', f.forma, 'host', f.host, 'porta', f.porta, 'usuario', f.usuario, 'chave_host', f.chave_host,
                'pasta', f.pasta, 'url_lista', f.url_lista, 'dominios_url', to_jsonb(f.dominios_url),
                'segredo_ref', f.segredo_ref, 'so_transferencias', f.so_transferencias, 'janela_par_s', f.janela_par_s,
                'dias_busca', f.dias_busca, 'transcrever', f.transcrever and c.transcrever,
                'transcrever_min_segundos', c.transcrever_min_segundos, 'bucket', c.bucket_gravacoes,
                'reprocessar', f.pedido_em is not null and f.reprocessar,
                'motivo', case when f.forma = 'arquivo' then 'envio' when f.pedido_em is not null then 'pedido'
                               else 'agendada' end,
                'carteiras', coalesce((select jsonb_object_agg(k.codigo, k.id) from public.credores k
                                        where k.empresa_id = f.empresa_id), '{}'::jsonb),
                'lotes', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'arquivos', l.arquivos) order by l.id)
                                     from public.voz_import_lotes l
                                    where l.config_id = f.id and l.situacao = 'pendente'), '[]'::jsonb))
                order by f.empresa_id, f.id)
              from public.voz_import_config f
              join public.voz_config c on c.empresa_id = f.empresa_id
              join public.empresas e on e.id = f.empresa_id
             where f.ativo and f.empresa_id % n = i - 1
               and ((f.forma in ('sftp', 'url') and (f.pedido_em is not null
                        or (f.leitura_automatica and (f.ultima_leitura_em is null
                             or f.ultima_leitura_em <= now() - make_interval(hours => f.intervalo_horas) + interval '5 minutes'))))
                    or (f.forma = 'arquivo' and exists (select 1 from public.voz_import_lotes l
                                                          where l.config_id = f.id and l.situacao = 'pendente')))),
            '[]'::jsonb),
        'apagar', coalesce((
            select jsonb_agg(jsonb_build_object('lote', l.id, 'caminhos',
                                                (select jsonb_agg(a ->> 'caminho') from jsonb_array_elements(l.arquivos) a))
                             order by l.id)
              from public.voz_import_lotes l
             where l.situacao in ('concluido', 'erro') and l.apagado_em is null and l.empresa_id % n = i - 1),
            '[]'::jsonb));
end $$;

create or replace function public.iniciar_importacao_voz(fonte bigint, origem text, lote bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    f public.voz_import_config;
    eid bigint;
begin
    perform public.vm_ou_servidor_importa();
    select * into f from public.voz_import_config x where x.id = fonte for update;
    if f.id is null or not f.ativo then
        raise exception 'fonte não encontrada ou pausada';
    end if;
    if origem not in ('agendada', 'pedido', 'envio') or (origem = 'envio') <> (lote is not null)
       or (origem = 'envio') <> (f.forma = 'arquivo') then
        raise exception 'origem: agendada | pedido (sftp/url) | envio (com o lote)';
    end if;
    if lote is not null then
        update public.voz_import_lotes l set situacao = 'processando'
         where l.id = lote and l.config_id = fonte and l.situacao = 'pendente';
        if not found then
            raise exception 'lote não está pendente nesta fonte';
        end if;
    end if;
    insert into public.voz_import_execucoes (empresa_id, config_id, origem)
    values (f.empresa_id, f.id, origem)
    returning id into eid;
    if lote is not null then
        update public.voz_import_lotes l set execucao_id = eid where l.id = lote;
    else
        update public.voz_import_config x set ultima_leitura_em = now(),
               pedido_em = case when origem = 'pedido' then null else x.pedido_em end,
               reprocessar = case when origem = 'pedido' then false else x.reprocessar end
         where x.id = fonte;
    end if;
    return eid;
end $$;

-- assinaturas de arquivos (sha-256 de nome, tamanho e data no servidor) que esta fonte já leu sem erro passageiro
create or replace function public.arquivos_lidos_importacao_voz(fonte bigint, assinaturas jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
    perform public.vm_ou_servidor_importa();
    if jsonb_typeof(assinaturas) is distinct from 'array' or jsonb_array_length(assinaturas) > 5000 then
        raise exception 'assinaturas: lista de até 5000';
    end if;
    return coalesce((select jsonb_agg(distinct a.assinatura) from public.voz_import_arquivos a
                      where a.config_id = fonte and not a.repetir
                        and a.assinatura in (select jsonb_array_elements_text(assinaturas))), '[]'::jsonb);
end $$;

-- par com a chamada do MotorCX e se a gravação já existe. Só lê. linhas: [{chave, id_chamada_motorcx, inicio,
-- duracao_s, id_cliente, id_acao, credor_id}] (até 1000). Devolve uma linha por chave:
--   {chave, existe, gravacao_id, caminho, chamada_atual, situacao: casada | avulsa | quarentena, motivo,
--    chamada_id, credor_id, id_cliente, id_acao}
create or replace function public.preparar_importacao_voz(execucao bigint, linhas jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    x public.voz_import_execucoes;
    f public.voz_import_config;
    res jsonb;
begin
    perform public.vm_ou_servidor_importa();
    select * into x from public.voz_import_execucoes e where e.id = execucao;
    if x.id is null or x.terminada_em is not null then
        raise exception 'execução não encontrada ou já concluída';
    end if;
    select * into f from public.voz_import_config c where c.id = x.config_id;
    if jsonb_typeof(linhas) is distinct from 'array' or jsonb_array_length(linhas) > 1000
       or exists (select 1 from jsonb_array_elements(linhas) l
                   where jsonb_typeof(l) <> 'object' or coalesce(l ->> 'chave', '') !~ '^[a-p]{24}$'
                      or (l ->> 'id_chamada_motorcx') !~ '^[A-Za-z0-9_.:\-]{4,80}$'
                      or (l ->> 'credor_id') !~ '^[0-9]{1,18}$') then
        raise exception 'linhas: lista de até 1000 {chave, inicio, ...} válidas';
    end if;
    with l as (
        select e.x ->> 'chave' as chave, nullif(e.x ->> 'id_chamada_motorcx', '') as id_chamada_motorcx,
               (e.x ->> 'inicio')::timestamptz as inicio, nullif(e.x ->> 'id_cliente', '') as id_cliente,
               nullif(e.x ->> 'id_acao', '') as id_acao, (e.x ->> 'credor_id')::bigint as credor_id, e.ord
          from jsonb_array_elements(linhas) with ordinality as e(x, ord)),
    cand as (
        select l.chave, v.id as chamada_id
          from l join public.voz_chamadas v on v.empresa_id = x.empresa_id
         where (l.id_chamada_motorcx is not null and v.id_chamada = l.id_chamada_motorcx and v.transferida_em is not null)
            or (l.id_chamada_motorcx is null and l.inicio is not null and v.transferencia = 'atendida'
                and v.transferida_em between l.inicio - make_interval(secs => f.janela_par_s)
                                         and l.inicio + make_interval(secs => f.janela_par_s)
                and (l.id_cliente is null or v.id_cliente = l.id_cliente)
                and (l.id_acao is null or v.id_acao = l.id_acao)
                and (l.credor_id is null or v.credor_id = l.credor_id))),
    par as (
        select c.chave, count(*) as n, min(c.chamada_id) as chamada_id from cand c group by c.chave),
    r as (
        select l.ord, l.chave, g.id as gravacao_id, g.caminho, g.chamada_id as chamada_atual, p.n,
               v.id as v_id, v.credor_id as v_credor, v.id_cliente as v_cliente, v.id_acao as v_acao,
               l.id_cliente, l.id_acao, l.credor_id, l.id_chamada_motorcx,
               exists (select 1 from public.voz_gravacoes o where o.chamada_id = v.id and o.origem = 'discador'
                          and o.chave_importacao is distinct from l.chave) as ocupada
          from l
          left join public.voz_gravacoes g on g.empresa_id = x.empresa_id and g.chave_importacao = l.chave
          left join par p on p.chave = l.chave
          left join public.voz_chamadas v on v.id = p.chamada_id and p.n = 1)
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'chave', r.chave, 'existe', r.gravacao_id is not null, 'gravacao_id', r.gravacao_id,
               'caminho', r.caminho, 'chamada_atual', r.chamada_atual,
               'situacao', case when r.v_id is not null and not r.ocupada
                                     and (r.id_cliente is null or r.id_cliente = r.v_cliente) then 'casada'
                                when coalesce(r.n, 0) = 0 and not f.so_transferencias and r.id_cliente is not null
                                     and r.id_chamada_motorcx is null then 'avulsa'
                                else 'quarentena' end,
               'motivo', case when r.v_id is not null and r.ocupada then 'chamada_com_gravacao'
                              when r.v_id is not null and r.id_cliente is not null and r.id_cliente <> r.v_cliente
                                   then 'par_conflitante'
                              when r.v_id is not null then null
                              when coalesce(r.n, 0) > 1 then 'par_ambiguo'
                              when not f.so_transferencias and r.id_cliente is null and r.id_chamada_motorcx is null
                                   then 'sem_cliente'
                              when not f.so_transferencias and r.id_chamada_motorcx is null then null
                              else 'sem_par' end,
               'chamada_id', case when r.v_id is not null and not r.ocupada then r.v_id end,
               'credor_id', case when r.v_id is not null then r.v_credor else r.credor_id end,
               'id_cliente', case when r.v_id is not null then r.v_cliente else r.id_cliente end,
               'id_acao', case when r.v_id is not null then r.v_acao else r.id_acao end)) order by r.ord), '[]'::jsonb)
      into res
      from r;
    return res;
end $$;

-- grava as gravações já no bucket da empresa. gravacoes: [{chave, caminho, chamada_id, credor_id, id_cliente, id_acao,
-- operador_ref, duracao_s, gravada_em, transcrever}]. Reenvio da mesma chave não duplica: só liga a chamada (se a
-- avulsa ganhou par) e completa o operador. Devolve [{chave, gravacao_id, nova}].
create or replace function public.registrar_importacao_voz(execucao bigint, gravacoes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    x public.voz_import_execucoes;
    res jsonb;
begin
    perform public.vm_ou_servidor_importa();
    select * into x from public.voz_import_execucoes e where e.id = execucao;
    if x.id is null or x.terminada_em is not null then
        raise exception 'execução não encontrada ou já concluída';
    end if;
    if jsonb_typeof(gravacoes) is distinct from 'array' or jsonb_array_length(gravacoes) > 1000 then
        raise exception 'gravacoes: lista de até 1000';
    end if;
    if exists (select 1 from jsonb_to_recordset(gravacoes) as g(chave text, caminho text, chamada_id bigint,
                                                                credor_id bigint, id_cliente text)
                where coalesce(g.chave, '') !~ '^[a-p]{24}$'
                   or coalesce(g.caminho, '') !~ ('^discador/[0-9]{4}/[0-9]{2}/[0-9]{2}/' || g.chave || '\.(wav|mp3|ogg|opus|flac|m4a)$')
                   or g.id_cliente is null
                   or (g.chamada_id is not null and not exists (select 1 from public.voz_chamadas v
                                                                where v.id = g.chamada_id and v.empresa_id = x.empresa_id))
                   or (g.credor_id is not null and not exists (select 1 from public.credores k
                                                               where k.id = g.credor_id and k.empresa_id = x.empresa_id))) then
        raise exception 'gravação com chave, caminho, cliente, chamada ou carteira inválidos (ou de outra empresa)';
    end if;
    with g as (
        select r.* from jsonb_to_recordset(gravacoes) as r(chave text, caminho text, chamada_id bigint, credor_id bigint,
                                                           id_cliente text, id_acao text, operador_ref text, duracao_s int,
                                                           gravada_em timestamptz, transcrever boolean)),
    ins as (
        insert into public.voz_gravacoes as v (empresa_id, credor_id, chamada_id, id_cliente, id_acao, origem, caminho,
                                               duracao_s, gravada_em, operador_ref, chave_importacao, fonte_id, transcricao)
        select x.empresa_id, g.credor_id, g.chamada_id, g.id_cliente, g.id_acao, 'discador', g.caminho, g.duracao_s,
               coalesce(g.gravada_em, now()), nullif(g.operador_ref, ''), g.chave, x.config_id,
               case when coalesce(g.transcrever, false) then 'pendente' else 'desligada' end
          from g
        on conflict (empresa_id, chave_importacao) where chave_importacao is not null do update set
            chamada_id = coalesce(v.chamada_id, excluded.chamada_id),
            credor_id = case when v.chamada_id is null and excluded.chamada_id is not null then excluded.credor_id
                             else v.credor_id end,
            id_acao = coalesce(v.id_acao, excluded.id_acao),
            operador_ref = coalesce(v.operador_ref, excluded.operador_ref)
        returning v.chave_importacao, v.id, (v.xmax = 0) as nova, v.chamada_id)
    select coalesce(jsonb_agg(jsonb_build_object('chave', ins.chave_importacao, 'gravacao_id', ins.id, 'nova', ins.nova)),
                    '[]'::jsonb)
      into res from ins;
    update public.voz_chamadas v set tem_gravacao = true
     where v.empresa_id = x.empresa_id and not v.tem_gravacao
       and v.id in (select (e ->> 'chamada_id')::bigint from jsonb_array_elements(gravacoes) e where e ? 'chamada_id');
    return res;
end $$;

-- relatório de um arquivo (manifesto) da execução, com as linhas recusadas para a quarentena (até 1000)
create or replace function public.registrar_arquivo_importacao_voz(execucao bigint, arquivo jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    x public.voz_import_execucoes;
    aid bigint;
    nm text;
begin
    perform public.vm_ou_servidor_importa();
    select * into x from public.voz_import_execucoes e where e.id = execucao;
    if x.id is null or x.terminada_em is not null then
        raise exception 'execução não encontrada ou já concluída';
    end if;
    if jsonb_typeof(arquivo) is distinct from 'object' or coalesce(arquivo ->> 'assinatura', '') !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(coalesce(arquivo -> 'quarentena', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(arquivo -> 'quarentena', '[]'::jsonb)) > 1000 then
        raise exception 'arquivo: {nome, assinatura, contagens, motivos, quarentena (até 1000)}';
    end if;
    nm := left(coalesce(nullif(btrim(arquivo ->> 'nome'), ''), '[sem nome]'), 120);
    if nm ~ '[0-9]{10,}' or nm ~ '@' then
        nm := '[nome descartado]';
    end if;
    insert into public.voz_import_arquivos (empresa_id, config_id, execucao_id, nome, assinatura, linhas, importadas,
                                            casadas, duplicadas, rejeitadas, sem_operador, minutos, erro, repetir, motivos)
    values (x.empresa_id, x.config_id, x.id, nm, arquivo ->> 'assinatura',
            coalesce((arquivo ->> 'linhas')::int, 0), coalesce((arquivo ->> 'importadas')::int, 0),
            coalesce((arquivo ->> 'casadas')::int, 0), coalesce((arquivo ->> 'duplicadas')::int, 0),
            coalesce((arquivo ->> 'rejeitadas')::int, 0), coalesce((arquivo ->> 'sem_operador')::int, 0),
            coalesce((arquivo ->> 'minutos')::numeric, 0), nullif(left(arquivo ->> 'erro', 300), ''),
            coalesce((arquivo ->> 'repetir')::boolean, false), coalesce(arquivo -> 'motivos', '{}'::jsonb))
    returning id into aid;
    insert into public.voz_import_quarentena (empresa_id, execucao_id, arquivo_id, ref_gravacao, motivo, linha, detalhe)
    select x.empresa_id, x.id, aid, q.ref, q.motivo, q.linha, nullif(left(q.detalhe, 120), '')
      from jsonb_to_recordset(coalesce(arquivo -> 'quarentena', '[]'::jsonb)) as q(ref text, motivo text, linha int, detalhe text);
    return aid;
end $$;

-- fecha a execução: totais = soma dos arquivos; o lote do envio pelo site fica concluído (ou erro)
create or replace function public.concluir_importacao_voz(execucao bigint, erro text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    x public.voz_import_execucoes;
    t record;
begin
    perform public.vm_ou_servidor_importa();
    select * into x from public.voz_import_execucoes e where e.id = execucao for update;
    if x.id is null or x.terminada_em is not null then
        raise exception 'execução não encontrada ou já concluída';
    end if;
    select count(*) as arquivos, coalesce(sum(a.linhas), 0) as lidas, coalesce(sum(a.casadas), 0) as casadas,
           coalesce(sum(a.rejeitadas), 0) as rejeitadas, coalesce(sum(a.importadas), 0) as importadas,
           coalesce(sum(a.duplicadas), 0) as duplicadas, coalesce(sum(a.sem_operador), 0) as sem_operador,
           coalesce(sum(a.minutos), 0) as minutos
      into t from public.voz_import_arquivos a where a.execucao_id = x.id;
    update public.voz_import_execucoes e set terminada_em = now(), arquivos = t.arquivos, lidas = t.lidas,
           casadas = t.casadas, quarentena = t.rejeitadas, importadas = t.importadas, duplicadas = t.duplicadas,
           sem_operador = t.sem_operador, minutos = t.minutos,
           erro = case when concluir_importacao_voz.erro is null then null
                       when concluir_importacao_voz.erro ~ '[0-9]{10,}' or concluir_importacao_voz.erro ~ '@'
                            then 'erro na leitura (detalhe com dado pessoal descartado)'
                       else left(concluir_importacao_voz.erro, 300) end
     where e.id = x.id;
    update public.voz_import_lotes l set situacao = case when concluir_importacao_voz.erro is null then 'concluido' else 'erro' end
     where l.execucao_id = x.id and l.situacao = 'processando';
    return jsonb_build_object('arquivos', t.arquivos, 'lidas', t.lidas, 'casadas', t.casadas, 'quarentena', t.rejeitadas,
                              'importadas', t.importadas, 'duplicadas', t.duplicadas);
end $$;

create or replace function public.marcar_envio_gravacoes_apagado(lote bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
    perform public.vm_ou_servidor_importa();
    update public.voz_import_lotes l set apagado_em = now()
     where l.id = lote and l.situacao in ('concluido', 'erro') and l.apagado_em is null;
end $$;

-- o worker da transcrição devolve a situação de cada gravação importada; na 1ª vez que dá certo, os minutos entram
-- no item voz_transcricao (custo real para a margem + quantidade da fatura, SQL 61). itens: [{gravacao_id, situacao,
-- duracao_s, transcricao_caminho}] (até 1000). Reenvio não cobra de novo. transcricao_caminho (só com ok): a
-- transcrição REDIGIDA que a VM subiu ao lado do áudio no bucket da empresa (<caminho sem extensão>.transcricao.json):
-- o leitor do site abre pela Edge Function gravacoes (ver_transcricoes, registro em acessos) e ela tem a mesma
-- retenção da gravação (ciclo de vida do bucket; a linha vai embora com a gravação). Outro caminho é recusado.
create or replace function public.registrar_transcricao_voz(empresa bigint, itens jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    mins numeric;
    n int;
begin
    perform public.vm_ou_servidor_importa();
    if jsonb_typeof(itens) is distinct from 'array' or jsonb_array_length(itens) > 1000
       or exists (select 1 from jsonb_array_elements(itens) i
                   where coalesce(i ->> 'gravacao_id', '') !~ '^[0-9]{1,18}$'
                      or coalesce(i ->> 'situacao', '') not in ('ok', 'abaixo_limiar', 'desligada', 'erro')
                      or (i ? 'transcricao_caminho' and i ->> 'situacao' <> 'ok')) then
        raise exception 'itens: lista de até 1000 {gravacao_id, situacao, duracao_s, transcricao_caminho (só com ok)}';
    end if;
    if exists (select 1 from jsonb_array_elements(itens) i
                join public.voz_gravacoes g on g.id = (i ->> 'gravacao_id')::bigint
               where i ->> 'transcricao_caminho' is not null
                 and i ->> 'transcricao_caminho' is distinct from
                     regexp_replace(g.caminho, '\.[A-Za-z0-9]{2,5}$', '') || '.transcricao.json') then
        raise exception 'transcricao_caminho: só ao lado do áudio da própria gravação (<caminho>.transcricao.json)';
    end if;
    with i as (
        select r.gravacao_id, r.situacao, r.duracao_s, r.transcricao_caminho from jsonb_to_recordset(itens)
            as r(gravacao_id bigint, situacao text, duracao_s numeric, transcricao_caminho text)),
    up as (
        update public.voz_gravacoes g set
               transcricao = i.situacao,
               transcricao_caminho = coalesce(i.transcricao_caminho, g.transcricao_caminho),
               transcrita_em = case when i.situacao = 'ok' then now() else g.transcrita_em end,
               minutos_transcritos = case when i.situacao = 'ok'
                                          then round(greatest(coalesce(i.duracao_s, g.duracao_s, 0), 0) / 60.0, 2) end
          from i
         where g.id = i.gravacao_id and g.empresa_id = registrar_transcricao_voz.empresa and g.origem = 'discador'
           and g.transcricao is distinct from 'ok'
        returning g.minutos_transcritos, g.transcricao)
    select coalesce(sum(up.minutos_transcritos) filter (where up.transcricao = 'ok'), 0), count(*) into mins, n from up;
    if mins > 0 then
        perform public.registrar_consumo_ia(empresa, 'voz_transcricao', mins);
    end if;
    return jsonb_build_object('atualizadas', n, 'minutos', mins);
end $$;

do $$
declare f regprocedure;
begin
    for f in select p.oid::regprocedure from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname in ('importacao_voz_pendente', 'iniciar_importacao_voz', 'arquivos_lidos_importacao_voz',
                                  'preparar_importacao_voz', 'registrar_importacao_voz', 'registrar_arquivo_importacao_voz',
                                  'concluir_importacao_voz', 'marcar_envio_gravacoes_apagado', 'registrar_transcricao_voz') loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
        execute format('grant execute on function %s to service_role', f);
    end loop;
end $$;

-- ================================================================ 9. acesso próprio da VM (voz_vm, SQL 57)
-- empresa da fonte, da execução ou do lote (toda chamada da VM exige empresa com voz)
create or replace function voz_vm.empresa_da_importacao(fonte bigint, execucao bigint, lote bigint) returns bigint
language sql stable security definer set search_path = '' as $$
    select coalesce((select f.empresa_id from public.voz_import_config f where f.id = fonte),
                    (select e.empresa_id from public.voz_import_execucoes e where e.id = execucao),
                    (select l.empresa_id from public.voz_import_lotes l where l.id = lote))
$$;
revoke all on function voz_vm.empresa_da_importacao(bigint, bigint, bigint) from public;

create or replace function voz_vm.checar_importacao(fonte bigint, execucao bigint, lote bigint) returns void
language plpgsql stable security definer set search_path = '' as $$
declare e bigint := voz_vm.empresa_da_importacao(fonte, execucao, lote);
begin
    if e is null or not voz_vm.tem_voz(e) then
        raise exception 'empresa sem voz configurada';
    end if;
end $$;
revoke all on function voz_vm.checar_importacao(bigint, bigint, bigint) from public;

create or replace function voz_vm.importacao_pendente(args jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
    select public.importacao_voz_pendente(coalesce(args ->> 'parte', '1/1'))
$$;
create or replace function voz_vm.iniciar_importacao(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    perform voz_vm.checar_importacao((args ->> 'fonte')::bigint, null, null);
    return to_jsonb(public.iniciar_importacao_voz((args ->> 'fonte')::bigint, args ->> 'origem', (args ->> 'lote')::bigint));
end $$;
create or replace function voz_vm.arquivos_lidos_importacao(args jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
    perform voz_vm.checar_importacao((args ->> 'fonte')::bigint, null, null);
    return public.arquivos_lidos_importacao_voz((args ->> 'fonte')::bigint, coalesce(args -> 'assinaturas', '[]'::jsonb));
end $$;
create or replace function voz_vm.preparar_importacao(args jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
    perform voz_vm.checar_importacao(null, (args ->> 'execucao')::bigint, null);
    return public.preparar_importacao_voz((args ->> 'execucao')::bigint, coalesce(args -> 'linhas', '[]'::jsonb));
end $$;
create or replace function voz_vm.registrar_importacao(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    perform voz_vm.checar_importacao(null, (args ->> 'execucao')::bigint, null);
    return public.registrar_importacao_voz((args ->> 'execucao')::bigint, coalesce(args -> 'gravacoes', '[]'::jsonb));
end $$;
create or replace function voz_vm.registrar_arquivo_importacao(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    perform voz_vm.checar_importacao(null, (args ->> 'execucao')::bigint, null);
    return to_jsonb(public.registrar_arquivo_importacao_voz((args ->> 'execucao')::bigint, args -> 'arquivo'));
end $$;
create or replace function voz_vm.concluir_importacao(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    perform voz_vm.checar_importacao(null, (args ->> 'execucao')::bigint, null);
    return public.concluir_importacao_voz((args ->> 'execucao')::bigint, args ->> 'erro');
end $$;
create or replace function voz_vm.marcar_envio_apagado(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    perform voz_vm.checar_importacao(null, null, (args ->> 'lote')::bigint);
    perform public.marcar_envio_gravacoes_apagado((args ->> 'lote')::bigint);
    return null;
end $$;
create or replace function voz_vm.registrar_transcricao(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz configurada';
    end if;
    return public.registrar_transcricao_voz((args ->> 'empresa')::bigint, coalesce(args -> 'itens', '[]'::jsonb));
end $$;

-- arquivos do envio pelo site: a VM baixa (lote pendente ou em processamento) e apaga (lote concluído) pelo bilhete
do $$
declare
    def text;
    lista text;
begin
    select pg_get_constraintdef(c.oid) into def from pg_constraint c
     where c.conrelid = 'voz_vm.bilhetes'::regclass and c.conname = 'bilhetes_bucket_check';
    if def is null or position('gravacoes-discador' in def) = 0 then
        select string_agg(quote_literal(b), ', ' order by b) into lista
          from (select distinct m[1] as b from regexp_matches(coalesce(def, ''), '''([a-z0-9-]+)''', 'g') as m
                union select unnest(array['saidas', 'entradas', 'chamados', 'gravacoes-discador'])) z;
        alter table voz_vm.bilhetes drop constraint if exists bilhetes_bucket_check;
        execute format('alter table voz_vm.bilhetes add constraint bilhetes_bucket_check check (bucket in (%s))', lista);
    end if;
end $$;
select pg_temp.trocar('voz_vm.empresa_do_caminho(text, text, text)',
    '    if operacao = ''baixar'' and bucket = ''saidas'' then',
    '    if bucket = ''gravacoes-discador'' then                -- SQL 64: envio de gravações pelo site
        if operacao not in (''baixar'', ''apagar'') then
            return null;
        end if;
        select l.empresa_id into e from public.voz_import_lotes l
         where l.arquivos @> jsonb_build_array(jsonb_build_object(''caminho'', caminho))
           and ((operacao = ''baixar'' and l.situacao in (''pendente'', ''processando''))
                or (operacao = ''apagar'' and l.situacao in (''concluido'', ''erro'') and l.apagado_em is null))
         limit 1;
        if e is null or not voz_vm.tem_voz(e)
           or split_part(caminho, ''/'', 1) <> (select x.slug from public.empresas x where x.id = e) then
            return null;
        end if;
        return e;
    end if;
    if operacao = ''baixar'' and bucket = ''saidas'' then');

revoke all on function voz_vm.importacao_pendente(jsonb), voz_vm.iniciar_importacao(jsonb),
    voz_vm.arquivos_lidos_importacao(jsonb), voz_vm.preparar_importacao(jsonb), voz_vm.registrar_importacao(jsonb),
    voz_vm.registrar_arquivo_importacao(jsonb), voz_vm.concluir_importacao(jsonb), voz_vm.marcar_envio_apagado(jsonb),
    voz_vm.registrar_transcricao(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.importacao_pendente(jsonb), voz_vm.iniciar_importacao(jsonb),
    voz_vm.arquivos_lidos_importacao(jsonb), voz_vm.preparar_importacao(jsonb), voz_vm.registrar_importacao(jsonb),
    voz_vm.registrar_arquivo_importacao(jsonb), voz_vm.concluir_importacao(jsonb), voz_vm.marcar_envio_apagado(jsonb),
    voz_vm.registrar_transcricao(jsonb) to motorcx_voz;
