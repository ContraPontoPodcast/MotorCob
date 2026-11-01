-- SQL 58 · Agente de voz: Fluxos (blocos em árvore, cognição e generativo), conectores de CRM, alçada da carteira,
-- passos e métricas por bloco, base de respostas e casos de teste
-- Protótipo aprovado pelo dono (ux/fluxo-agente-prototipo.html, necessidades FL1 a FL8) e decisões do dono:
-- 1. Credencial dos conectores: quem grava no cofre é a equipe MotorCX (permissão nova de equipe
--    gerenciar_conectores_crm: Master e Técnico), como já é com o tronco. A empresa vê só a referência (segredo_ref).
--    O cadastro técnico do conector (URL, mapas, teste, ativar) também é da equipe, pelo mesmo motivo.
-- 2. Ofertas: a alçada da carteira (voz_alcada_carteira) é o teto também das ofertas que vêm do CRM. Oferta do CRM
--    acima da alçada é descartada pelo executor (voz/fluxo.py), que grava o código oferta_acima_alcada em
--    crm_chamadas. Por isso todo fluxo que oferece (bloco Oferta ou Generativo com apresentar_oferta) precisa de
--    alçada vigente para ser aprovado.
-- 3. Confirmar identidade: pode usar o modo cognição, mas a conferência é feita SÓ pelo CRM (conector Validar
--    cadastro), nunca pela IA. Nunca no modo generativo (o validador recusa). Sem o conector: pendência
--    identidade_sem_conferencia, que segura a aprovação.
-- 4. Teste A/B: fica para depois (nada aqui).
-- 5. Casos de teste guardados: voz_fluxo_casos_teste, que o simulador de texto roda a cada nova versão; caso que
--    falhou na versão segura a aprovação dela.
-- 6. IPs no firewall do CRM: o dono resolve com os clientes. Saída dos conectores pelos IPs fixos das VMs
--    (35.198.40.10 e 34.39.217.31), os mesmos do tronco.
--
-- Tabelas: voz_fluxos, voz_fluxo_versoes, voz_fluxo_modelos (FL1) · voz_intencoes (FL3) · crm_hosts_permitidos,
-- crm_conectores (FL4) · crm_chamadas (FL5) · voz_alcada_carteira (FL6) · voz_fluxo_passos, voz_fluxo_metricas_dia,
-- voz_fluxo_intencoes_dia (FL7) · voz_base_respostas (FL8) · voz_fluxo_casos_teste, voz_fluxo_casos_resultados.
-- voz_chamadas ganha fluxo_versao_id e bloco_final. variaveis_voz() ganha 'assessoria' (nome da própria empresa,
-- usado no recado neutro).
-- Validador: fluxo_voz_erros(jsonb) (lista de erros), fluxo_voz_valido(jsonb) (check e RPCs) e fluxo_voz_forma_ok(jsonb)
-- (o mínimo que até um rascunho precisa ter). Cópia fiel em voz/fluxo_validador.py; os mesmos casos
-- (voz/fluxo_casos.py) rodam nos dois lados (tests/test_voz_fluxo_validador.py e supabase/testes/testar_rls.py).
-- Pendências que dependem do banco (conector ativo e da finalidade certa, alçada vigente, intenção do catálogo):
-- fluxo_voz_pendencias(empresa, credor, definicao). Seguram a aprovação e a entrada em uso.
-- Migração: cada voz_roteiros em uso vira um fluxo v1 "Generativo único", em RASCUNHO (Abertura → Confirmar identidade →
-- Conversa generativa com o prompt atual → Transferir/Encerrar; regras_transferencia vira as saídas do bloco).
-- voz_roteiros continua editável: fica só leitura num SQL à parte, quando a tela de Fluxos entrar no site.
--
-- LGPD: nenhuma coluna guarda CPF, nome, telefone, e-mail, endereço, cartão, senha ou corpo de resposta do CRM.
-- crm_chamadas, voz_fluxo_passos e as métricas só têm códigos fechados, contagens e tempos. A resposta do CRM fica
-- só na memória da ligação (voz/fluxo.py). exemplo_resposta é gravado pela VM com os valores trocados por
-- exemplos, e o check recusa texto com cara de documento, telefone ou e-mail.
-- Quem grava passos e chamadas de conector é a VM (chave do servidor ou voz_vm, item 17); resultados de casos, o
-- simulador (service_role). O site só escreve
-- por RPC security definer com search_path fixo. RLS em tudo e nada para anon.
-- Depende do SQL 56 (agente de voz) e do SQL 57 (voz_vm). Pode rodar de novo sem erro.
--
-- ---------------------------------------------------------------- acesso próprio da VM (schema voz_vm do SQL 57)
-- A VM de voz entra no banco de dois jeitos (voz/acesso.py): a chave do servidor (piloto) ou o papel motorcx_voz do
-- SQL 57, que só enxerga o schema voz_vm e é obrigatório antes do modo real. O item 17 dá ao voz_vm o que o executor
-- do fluxo e a geração por IA usam, no mesmo padrão do SQL 57 (views de colunas escolhidas; escrita e RPC só por
-- funções security definer com search_path vazio e validação por linha):
--   LER    · voz_vm.crm_conectores (só 'ativo', sem exemplo_resposta nem quem testou; segredo_ref é o NOME do segredo:
--            a VM lê o valor no Secret Manager), voz_vm.crm_hosts_permitidos, voz_vm.base_respostas (só as revisadas);
--          · voz_vm.fluxo_em_uso(args) e voz_vm.alcada_vigente(args) no lugar das RPCs fluxo_voz_em_uso e
--            alcada_voz_vigente (mesmo formato de resposta do PostgREST);
--          · voz_vm.empresas ganha nome (variável assessoria do recado neutro), no próprio SQL 57.
--   GRAVAR · voz_vm.gravar_chamadas passa a aceitar fluxo_versao_id e bloco_final (versão da mesma empresa);
--          · voz_vm.gravar_fluxo_passos (upsert por empresa, id_chamada e ordem) e voz_vm.gravar_crm_chamadas (só
--            códigos, nunca o corpo da resposta do CRM: chave fora da lista é recusada);
--   GERAÇÃO· voz_vm.pegar_pedido_fluxo, registrar_geracao_fluxo, anexos_fluxo_vencidos e marcar_anexos_apagados, e
--            bilhete 'apagar' (Edge Function voz-arquivos) só para anexo que o banco já liberou (anexos_fluxo_vencidos).
-- Não passam pela VM: teste de conector e resultado dos casos (Edge Function simular_fluxo_voz, service_role). As
-- métricas do dia (voz_fluxo_metricas_dia, voz_fluxo_intencoes_dia) ainda não têm job; quando tiver, ganha função aqui.
-- Depende do SQL 57 (roda depois dele pela ordem dos arquivos). Se o SQL 57 for rodado de novo, rode este depois
-- (o 57 refaz voz_vm.gravar_chamadas e voz_vm.empresa_do_caminho sem o fluxo).
--
-- Conferência (no SQL Editor do Supabase, depois de rodar):
--   select (select count(*) from pg_tables where schemaname = 'public'
--             and tablename in ('voz_fluxos', 'voz_fluxo_versoes', 'voz_fluxo_modelos', 'voz_intencoes', 'crm_hosts_permitidos',
--                               'crm_conectores', 'crm_chamadas', 'voz_alcada_carteira', 'voz_fluxo_passos',
--                               'voz_fluxo_metricas_dia', 'voz_fluxo_intencoes_dia', 'voz_base_respostas',
--                               'voz_fluxo_casos_teste', 'voz_fluxo_casos_resultados')) as tabelas,              -- 14
--          (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity
--             and (tablename like 'voz\_fluxo%' or tablename like 'crm\_%'
--                  or tablename in ('voz_intencoes', 'voz_alcada_carteira', 'voz_base_respostas'))) as sem_rls,   -- 0
--          (select count(*) from public.voz_fluxo_modelos where public.fluxo_voz_valido(definicao)) as modelos,    -- 4
--          (select count(*) from public.voz_roteiros where situacao = 'em_uso') as roteiros_em_uso,
--          (select count(*) from public.voz_fluxos where roteiro_origem_id is not null) as fluxos_migrados,      -- = roteiros_em_uso
--          public.fluxo_voz_erros('{"esquema": 1, "blocos": []}') as erros_vazio,                             -- {abertura_ausente}
--          (select count(*) from public.permissoes_equipe_catalogo where permissao = 'gerenciar_conectores_crm'
--             and master and tecnico and not atendimento and not comercial and not administrativo) as perm_equipe, -- 1
--          has_table_privilege('anon', 'public.crm_conectores', 'select') as anon_le,                          -- false
--          has_function_privilege('motorcx_voz', 'voz_vm.gravar_fluxo_passos(jsonb)', 'execute')
--            and has_function_privilege('motorcx_voz', 'voz_vm.fluxo_em_uso(jsonb)', 'execute')
--            and has_table_privilege('motorcx_voz', 'voz_vm.crm_conectores', 'select') as vm_fluxo,         -- true
--          has_table_privilege('motorcx_voz', 'public.crm_conectores', 'select') as vm_le_public,            -- false
--          position('fluxo_versao_id' in pg_get_functiondef('voz_vm.gravar_chamadas(jsonb)'::regprocedure)) > 0
--            as vm_grava_fluxo_na_chamada;                                                                    -- true
--   Migrados (todos em rascunho até a empresa escolher o conector de validação e aprovar; o motivo diz o que falta):
--   select f.empresa_id, f.credor_id, v.versao, v.situacao, v.motivo,
--          public.fluxo_voz_erros(v.definicao) as erros from public.voz_fluxos f
--     join public.voz_fluxo_versoes v on v.fluxo_id = f.id where f.roteiro_origem_id is not null;

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

-- ================================================================ 1. permissão nova da equipe e variável 'assessoria'
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
    ('ligar_voz_real', 'Atendimento', 'Ligar as ligações reais do agente de voz', true, true, false, false, false),
    -- SQL 58 · conectores de CRM do agente de voz (credencial no cofre, hosts liberados, teste e ativação)
    ('gerenciar_conectores_crm', 'Técnico', 'Conectores de CRM do agente de voz e a credencial no cofre', true, false, false, false, true)
) as c(permissao, grupo, nome, master, atendimento, comercial, administrativo, tecnico);
grant select on public.permissoes_equipe_catalogo to authenticated;
revoke all on public.permissoes_equipe_catalogo from anon;

create or replace function public.cuida_conectores(eid bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select public.equipe_pode('gerenciar_conectores_crm', eid)
$$;
revoke all on function public.cuida_conectores(bigint) from public, anon;
grant execute on function public.cuida_conectores(bigint) to authenticated;

-- 'assessoria' = nome da própria empresa (a que liga). Não é dado do devedor; entra no recado neutro.
create or replace function public.variaveis_voz() returns text[]
language sql immutable parallel safe as $$
    select array['primeiro_nome', 'credor', 'saldo', 'dias_atraso', 'vencimento', 'link_pagamento',
                 'valor_minimo', 'parcelas_max', 'desconto_max', 'assessoria']::text[]
$$;

-- ================================================================ 2. listas fechadas do fluxo
-- campos de oferta que o mapa de saída de um conector preenche e que a fala pode citar
create or replace function public.campos_oferta_voz() returns text[]
language sql immutable parallel safe as $$
    select array['oferta.id', 'oferta.parcelas', 'oferta.valor_parcela', 'oferta.desconto_pct', 'oferta.vencimento',
                 'oferta.valor_total', 'oferta.entrada']::text[]
$$;

-- códigos que crm_chamadas.resultado_codigo aceita (o conector devolve só isto ao MotorCX)
create or replace function public.codigos_conector_voz() returns text[]
language sql immutable parallel safe as $$
    select array['ok', 'falhou', 'ofertas_0', 'ofertas_1_3', 'ofertas_4_mais', 'oferta_acima_alcada',
                 'identidade_ok', 'identidade_nao_confere', 'acordo_registrado', 'acordo_recusado',
                 'boleto_gerado', 'boleto_falhou', 'link_gerado', 'link_falhou']::text[]
$$;

-- auxiliares do validador (imutáveis; mesmas regras de voz/fluxo_validador.py)
create or replace function public.fluxo_voz_aux_inteiro(v jsonb, de numeric, ate numeric) returns boolean
language sql immutable parallel safe as $$
    select coalesce(jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
                    and (v #>> '{}')::numeric between de and ate, false)
$$;
create or replace function public.fluxo_voz_aux_codigo(v jsonb) returns boolean
language sql immutable parallel safe as $$
    select coalesce(jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^[a-z][a-z0-9_]{1,40}$', false)
$$;
create or replace function public.fluxo_voz_aux_em(v jsonb, lista text[]) returns boolean
language sql immutable parallel safe as $$
    select coalesce(jsonb_typeof(v) = 'string' and (v #>> '{}') = any (lista), false)
$$;
create or replace function public.fluxo_voz_aux_textos(v jsonb, maximo int, tam int) returns boolean
language sql immutable parallel safe as $$
    select coalesce(jsonb_typeof(v) = 'array' and jsonb_array_length(v) <= maximo
                    and not exists (select 1 from jsonb_array_elements(v) x
                                     where jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') not between 1 and tam), false)
$$;
-- variáveis {{ }} de um texto (sem espaços nas pontas)
create or replace function public.fluxo_voz_aux_variaveis(t text) returns text[]
language sql immutable parallel safe as $$
    select coalesce(array_agg(btrim(m[1], E' \t\n\r')), '{}') from regexp_matches(coalesce(t, ''), '\{\{([^}]*)\}\}', 'g') m
$$;
-- fala que pede senha ou cartão (trava 2). Mesma troca de acentos do Python.
create or replace function public.fluxo_voz_aux_pede_senha(t text) returns boolean
language sql immutable parallel safe as $$
    select translate(lower(t), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')
           ~ '(senha|numero do cartao|codigo de seguranca|cvv)'
$$;
-- textos do bloco que viram fala ou orientam a IA: (campo, texto)
create or replace function public.fluxo_voz_aux_textos_bloco(b jsonb) returns table (campo text, texto text)
language sql immutable parallel safe as $$
    select k, b -> 'params' ->> k from unnest(array['fala', 'fala_espera', 'objetivo']) k
     where jsonb_typeof(b -> 'params') = 'object' and jsonb_typeof(b -> 'params' -> k) = 'string'
$$;
-- o bloco trata de valor, oferta ou credor da dívida?
create or replace function public.fluxo_voz_aux_sensivel(b jsonb) returns boolean
language sql immutable parallel safe as $$
    select b ->> 'tipo' in ('oferta', 'generativa', 'registrar', 'link')
        or exists (select 1 from public.fluxo_voz_aux_textos_bloco(b) t, unnest(public.fluxo_voz_aux_variaveis(t.texto)) v
                    where v = any (array_remove(public.variaveis_voz() || public.campos_oferta_voz(), 'primeiro_nome'))
                      and v <> 'assessoria')
$$;
-- alcance no grafo (arestas o --q--> p). pular_identidade: não segue a saída "confirmou" desses blocos.
create or replace function public.fluxo_voz_aux_alcance(eo text[], eq text[], ep text[], ini text,
                                                        pular_identidade text[], incluir_inicio boolean)
returns text[]
language sql immutable parallel safe as $$
    with recursive a (o, q, p) as (select * from unnest(eo, eq, ep)),
    r (n) as (
        select a.p from a where a.o = ini and not (a.o = any (pular_identidade) and a.q = 'confirmou')
        union
        select a.p from r join a on a.o = r.n where not (a.o = any (pular_identidade) and a.q = 'confirmou')
    )
    select array(select n from r union select ini where incluir_inicio)
$$;

-- ================================================================ 3. FL2 · validador do fluxo
-- Esquema 1: {esquema: 1, blocos: [{id ^N\d{1,3}$, tipo (13), modo, x, y, titulo, repetir_max 1..5, params por tipo,
-- saidas: [{rotulo, para, tipo normal|devolve|falha, quando}]}]}. `quando` diz em que caso o executor segue a saída.
-- Devolve os erros como 'codigo' ou 'codigo:ID', em ordem (collate "C") e sem repetição. Vazio = válido.
create or replace function public.fluxo_voz_erros(d jsonb) returns text[]
language plpgsql immutable parallel safe set search_path = public as $$
declare
    tipos constant text[] := array['abertura', 'identidade', 'pergunta', 'intencao', 'generativa', 'oferta', 'retorno',
                                   'conector', 'registrar', 'link', 'condicao', 'transferir', 'encerrar'];
    finais constant text[] := array['transferir', 'encerrar'];
    com_fala constant text[] := array['abertura', 'identidade', 'pergunta', 'intencao', 'oferta', 'retorno', 'link',
                                      'transferir', 'encerrar'];
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
    i text; j text; n int;
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
                when 'abertura' then array['fala']
                when 'identidade' then array['fala', 'pergunta', 'conector_id', 'tentativas']
                when 'pergunta' then array['fala', 'opcoes', 'tentativas']
                when 'intencao' then array['fala', 'intencoes', 'exemplos', 'confianca_min', 'tentativas', 'entidades']
                when 'generativa' then array['objetivo', 'tom', 'max_turnos', 'ferramentas', 'contrapropostas_max']
                when 'oferta' then array['fala', 'origem', 'conector_id']
                when 'retorno' then array['fala', 'dias_max']
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
            validos := obrig || 'sem_resposta'::text;
        elsif tipo = 'intencao' then
            obrig := case when jsonb_typeof(p -> 'intencoes') = 'array'
                          then array(select x #>> '{}' from jsonb_array_elements(p -> 'intencoes') x where jsonb_typeof(x) = 'string')
                          else '{}' end || 'nao_entendido'::text;
            validos := obrig;
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

create or replace function public.fluxo_voz_valido(d jsonb) returns boolean
language sql immutable parallel safe as $$
    select cardinality(public.fluxo_voz_erros(d)) = 0
$$;

-- o mínimo que até um rascunho precisa ter (o resto segura só a aprovação)
create or replace function public.fluxo_voz_forma_ok(d jsonb) returns boolean
language sql immutable parallel safe as $$
    select octet_length(d::text) <= 400000
       and not exists (select 1 from unnest(public.fluxo_voz_erros(d)) e
                        where split_part(e, ':', 1) in ('esquema_invalido', 'blocos_demais', 'id_invalido', 'id_repetido',
                                                        'tipo_invalido', 'bloco_invalido'))
$$;

-- ================================================================ 4. FL3 · catálogo de intenções (equipe MotorCX)
create table if not exists public.voz_intencoes (
    codigo     text primary key check (codigo ~ '^[a-z][a-z0-9_]{1,40}$' and codigo <> 'nao_entendido'),
    nome       text not null check (char_length(trim(nome)) between 2 and 60),
    descricao  text check (char_length(descricao) <= 300),
    ativa      boolean not null default true,
    atualizado_em timestamptz not null default now()
);
comment on table public.voz_intencoes is
    'Catálogo fechado de intenções da Cognição (equipe MotorCX). Frases de exemplo da empresa ficam no bloco, na definição.';
insert into public.voz_intencoes (codigo, nome, descricao) values
    ('quero_negociar', 'Quer negociar', 'Pede condição, parcelamento ou desconto.'),
    ('ja_paguei', 'Já paguei', 'Diz que já pagou.'),
    ('nao_reconheco', 'Não reconhece', 'Não reconhece ou contesta a dívida.'),
    ('sem_dinheiro', 'Sem dinheiro agora', 'Quer resolver, mas não pode agora.'),
    ('pedir_humano', 'Pede um atendente', 'Quer falar com uma pessoa (trava: transfere sempre).'),
    ('nao_me_ligue', 'Não me ligue', 'Pede para não receber mais ligações (trava: opt-out e encerra).'),
    ('pedir_fora_alcada', 'Pede fora da alçada', 'Pede desconto, parcelas ou prazo acima da alçada.'),
    ('escolher_oferta', 'Escolhe uma oferta', 'Escolhe uma das ofertas apresentadas.'),
    ('aceitar', 'Aceita', 'Aceita a proposta.'),
    ('recusar', 'Recusa', 'Recusa a proposta.'),
    ('quer_outra_condicao', 'Quer outra condição', 'Pede outra condição dentro da alçada.'),
    ('informou_data', 'Informou uma data', 'Diz uma data (pagamento, nascimento, retorno).'),
    ('nao_lembra', 'Não lembra', 'Não sabe ou não lembra a informação pedida.'),
    ('agendar_retorno', 'Pede retorno', 'Pede para ligar em outro dia ou horário.')
on conflict (codigo) do nothing;
alter table public.voz_intencoes enable row level security;
drop policy if exists voz_intencoes_ver on public.voz_intencoes;
create policy voz_intencoes_ver on public.voz_intencoes for select to authenticated using (true);
revoke all on public.voz_intencoes from anon;
revoke insert, update, delete on public.voz_intencoes from authenticated;

-- ================================================================ 5. FL4 · conectores de CRM
create table if not exists public.crm_hosts_permitidos (
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    host          text not null check (char_length(host) <= 253
                                       and host ~ '^([a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$'
                                       and host !~ '(^|\.)(localhost|local|internal|intranet|lan|home|corp)$'
                                       and host !~ '(^|\.)(metadata\.google\.internal|metadata)$'),
    liberado_por  uuid default auth.uid() references auth.users (id) on delete set null,
    liberado_em   timestamptz not null default now(),
    primary key (empresa_id, host)
);
comment on table public.crm_hosts_permitidos is
    'Hosts (nome DNS público, nunca IP) que os conectores da empresa podem chamar. Só a equipe MotorCX libera: '
    'o conector não pode virar porta para a rede interna.';
alter table public.crm_hosts_permitidos enable row level security;
drop policy if exists crm_hosts_ver on public.crm_hosts_permitidos;
create policy crm_hosts_ver on public.crm_hosts_permitidos for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.crm_hosts_permitidos from anon;
revoke insert, update, delete on public.crm_hosts_permitidos from authenticated;

-- origem dos campos que vão ao CRM (nenhum dado pessoal além do que a pessoa fala para se identificar)
create or replace function public.origens_entrada_conector() returns text[]
language sql immutable parallel safe as $$
    select array['id_cliente', 'contrato_ref', 'id_chamada', 'data_informada', 'ano_informado', 'digitos_informados',
                 'oferta.id', 'data_promessa', 'valor_promessa', 'acordo.id']::text[]
$$;
-- destinos que o mapa de saída preenche (memória da ligação) e 'codigo' (o único que fica no MotorCX)
create or replace function public.destinos_saida_conector() returns text[]
language sql immutable parallel safe as $$
    select public.campos_oferta_voz() || array['acordo.id', 'link_pagamento', 'codigo']::text[]
$$;
-- nomes que denunciam dado pessoal (CPF, documento, endereço, e-mail, telefone, cartão, senha, nome, mãe). A data que a
-- pessoa fala para se identificar (data_informada) pode ir com o nome que o CRM usa (ex.: birthDayMonth).
create or replace function public.nome_pessoal_conector(t text) returns boolean
language sql immutable parallel safe as $$
    select lower(coalesce(t, '')) ~ '(cpf|cnpj|document|rg_|^rg$|endereco|address|street|cep|zip|email|e_mail|mail|phone|telefone|celular|mobile|whats|card|cartao|pan$|cvv|senha|password|passwd|mother|mae|nome|name)'
$$;

-- mapa_entrada: [{origem ∈ origens_entrada_conector(), destino (nome no CRM), onde path|query|corpo|cabecalho}]
-- mapa_saida:   [{origem JSONPath simples, destino ∈ destinos_saida_conector(), grava nao|codigo, valores {valor_crm: código}}]
--               grava = codigo só com destino codigo (e vice-versa); valores só em codigo, mapeando para codigos_conector_voz().
create or replace function public.mapa_conector_valido(entrada jsonb, saida jsonb) returns boolean
language plpgsql immutable parallel safe as $$
declare m jsonb;
begin
    if jsonb_typeof(entrada) is distinct from 'array' or jsonb_typeof(saida) is distinct from 'array'
       or jsonb_array_length(entrada) > 12 or jsonb_array_length(saida) > 20 then
        return false;
    end if;
    for m in select x from jsonb_array_elements(entrada) x loop
        if jsonb_typeof(m) <> 'object' or exists (select 1 from jsonb_object_keys(m) k where k not in ('origem', 'destino', 'onde'))
           or not public.fluxo_voz_aux_em(m -> 'origem', public.origens_entrada_conector())
           or not coalesce(jsonb_typeof(m -> 'destino') = 'string' and (m ->> 'destino') ~ '^[A-Za-z][A-Za-z0-9_.\-]{0,59}$', false)
           or public.nome_pessoal_conector(m ->> 'destino')
           or not public.fluxo_voz_aux_em(m -> 'onde', array['path', 'query', 'corpo', 'cabecalho']) then
            return false;
        end if;
        if (m ->> 'onde') = 'cabecalho' and lower(m ->> 'destino') in ('authorization', 'proxy-authorization', 'cookie') then
            return false;
        end if;
    end loop;
    for m in select x from jsonb_array_elements(saida) x loop
        if jsonb_typeof(m) <> 'object'
           or exists (select 1 from jsonb_object_keys(m) k where k not in ('origem', 'destino', 'grava', 'valores'))
           or not coalesce(jsonb_typeof(m -> 'origem') = 'string' and char_length(m ->> 'origem') <= 120
                           and (m ->> 'origem') ~ '^\$(\.[A-Za-z_][A-Za-z0-9_]*|\[\*\]|\[[0-9]{1,2}\])*$', false)
           or public.nome_pessoal_conector(m ->> 'origem')
           or not public.fluxo_voz_aux_em(m -> 'destino', public.destinos_saida_conector())
           or not public.fluxo_voz_aux_em(m -> 'grava', array['nao', 'codigo'])
           or ((m ->> 'grava') = 'codigo') <> ((m ->> 'destino') = 'codigo') then
            return false;
        end if;
        if m ? 'valores' and ((m ->> 'destino') <> 'codigo' or jsonb_typeof(m -> 'valores') <> 'object'
               or exists (select 1 from jsonb_each(m -> 'valores') e
                           where char_length(e.key) > 60 or not public.fluxo_voz_aux_em(e.value, public.codigos_conector_voz()))) then
            return false;
        end if;
    end loop;
    return true;
end $$;

-- cabeçalhos fixos: nada de credencial (ela vai pelo cofre)
create or replace function public.cabecalhos_conector_validos(c jsonb) returns boolean
language sql immutable parallel safe as $$
    select coalesce(jsonb_typeof(c) = 'object'
           and (select count(*) from jsonb_object_keys(c)) <= 10
           and not exists (select 1 from jsonb_each(c) e
                            where e.key !~ '^[A-Za-z0-9\-]{1,40}$'
                               or lower(e.key) in ('authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'idempotency-key')
                               or lower(e.key) ~ '(token|secret|senha|password|api-?key|auth|signature)'
                               or jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') > 200), false)
$$;

-- exemplo de resposta (gravado pela VM com os valores trocados por exemplos): sem cara de documento, telefone ou e-mail
create or replace function public.exemplo_resposta_seguro(j jsonb) returns boolean
language sql immutable parallel safe as $$
    select j is null or (octet_length(j::text) <= 16384 and j::text !~ '[0-9]{9,}' and j::text !~ '@'
                         and j::text !~ '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}')
$$;

create table if not exists public.crm_conectores (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    nome             text not null check (char_length(trim(nome)) between 2 and 60),
    finalidade       text not null check (finalidade in ('buscar_ofertas', 'validar_cadastro', 'registrar_acordo',
                                                         'gerar_boleto', 'gerar_link', 'outro')),
    metodo           text not null check (metodo in ('GET', 'POST', 'PUT')),
    url              text not null check (char_length(url) <= 500
                                          and url ~ '^https://([a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(:[0-9]{2,5})?(/[A-Za-z0-9_.~%\-{}/]*)?(\?[A-Za-z0-9_.~%\-{}=&]*)?$'),
    autenticacao     text not null check (autenticacao in ('api_key_header', 'bearer', 'oauth2_cc', 'basic', 'mtls')),
    segredo_ref      text check (segredo_ref ~ '^[A-Za-z0-9_\-/.]{1,120}$'),
    cabecalhos_fixos jsonb not null default '{}' check (public.cabecalhos_conector_validos(cabecalhos_fixos)),
    mapa_entrada     jsonb not null default '[]',
    mapa_saida       jsonb not null default '[]',
    timeout_ms       int not null default 2500 check (timeout_ms between 500 and 8000),
    tentativas       int not null default 0 check (tentativas between 0 and 2),
    idempotencia     boolean not null default false,
    em_falha         text not null default 'ramo' check (em_falha in ('ramo', 'alternativa_carteira', 'transferir')),
    situacao         text not null default 'rascunho' check (situacao in ('rascunho', 'ativo', 'pausado')),
    versao           int not null default 1 check (versao >= 1),
    exemplo_resposta jsonb check (public.exemplo_resposta_seguro(exemplo_resposta)),
    teste_pedido_em  timestamptz,
    testado_em       timestamptz,
    teste_ok         boolean,
    testado_por      uuid references auth.users (id) on delete set null,
    credencial_trocada_em timestamptz,
    criado_por       uuid default auth.uid() references auth.users (id) on delete set null,
    criado_em        timestamptz not null default now(),
    atualizado_em    timestamptz not null default now(),
    unique (empresa_id, nome),
    unique (id, empresa_id),
    check (public.mapa_conector_valido(mapa_entrada, mapa_saida)),
    check (metodo = 'GET' or tentativas = 0 or idempotencia),            -- POST/PUT só repete com Idempotency-Key
    check (em_falha <> 'alternativa_carteira' or finalidade = 'buscar_ofertas'),
    check (situacao <> 'ativo' or (teste_ok and segredo_ref is not null))
);
comment on table public.crm_conectores is
    'Conectores de CRM da empresa (Empresa › Integrações). Credencial só no cofre: segredo_ref é o NOME do segredo '
    '(Secret Manager do MotorCX). Escrita só pela equipe (gerenciar_conectores_crm), por RPC. A resposta do CRM nunca é '
    'gravada: fica na memória da ligação; no MotorCX ficam só os códigos de crm_chamadas.';
comment on column public.crm_conectores.exemplo_resposta is
    'Resposta do último teste bem-sucedido com os valores trocados por exemplos pela VM. Usada pelo simulador.';
comment on column public.crm_conectores.em_falha is
    'ramo = segue a saída "falhou" do bloco; alternativa_carteira = ofertas e alçada da carteira (só buscar_ofertas); '
    'transferir = transfere para humano.';
alter table public.crm_conectores enable row level security;
drop policy if exists crm_conectores_ver on public.crm_conectores;
create policy crm_conectores_ver on public.crm_conectores for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.crm_conectores from anon;
revoke insert, update, delete on public.crm_conectores from authenticated;

-- o host da URL tem de estar liberado para a empresa
create or replace function public.validar_conector_crm() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if not exists (select 1 from public.crm_hosts_permitidos h
                    where h.empresa_id = new.empresa_id and h.host = substring(new.url from '^https://([^/:?#]+)')) then
        raise exception 'o host de % não está liberado para esta empresa (crm_hosts_permitidos)', new.url;
    end if;
    return new;
end $$;
revoke all on function public.validar_conector_crm() from public, anon, authenticated;
drop trigger if exists validar_conector_crm on public.crm_conectores;
create trigger validar_conector_crm before insert or update of url, empresa_id on public.crm_conectores
    for each row execute function public.validar_conector_crm();

-- ================================================================ 6. FL6 · alçada da carteira (com vigência)
-- ofertas_padrao: [{id, parcelas 1..parcelas_max, desconto_pct 0..desconto_max_pct, entrada? >= 0}] (até 6)
create or replace function public.ofertas_alcada_validas(o jsonb, desconto_max numeric, parcelas_max int) returns boolean
language sql immutable parallel safe as $$
    select coalesce(jsonb_typeof(o) = 'array' and jsonb_array_length(o) <= 6
           and not exists (select 1 from jsonb_array_elements(o) x
                            where jsonb_typeof(x) <> 'object'
                               or exists (select 1 from jsonb_object_keys(x) k where k not in ('id', 'parcelas', 'desconto_pct', 'entrada'))
                               or not coalesce(jsonb_typeof(x -> 'id') = 'string' and (x ->> 'id') ~ '^[A-Za-z0-9_\-]{1,40}$', false)
                               or not public.fluxo_voz_aux_inteiro(x -> 'parcelas', 1, parcelas_max)
                               or not coalesce(jsonb_typeof(x -> 'desconto_pct') = 'number'
                                               and (x ->> 'desconto_pct')::numeric between 0 and desconto_max, false)
                               or (x ? 'entrada' and not coalesce(jsonb_typeof(x -> 'entrada') = 'number'
                                                                  and (x ->> 'entrada')::numeric >= 0, false)))
           and (select count(distinct x ->> 'id') = count(*) from jsonb_array_elements(o) x), false)
$$;

create table if not exists public.voz_alcada_carteira (
    id                bigint generated always as identity primary key,
    empresa_id        bigint not null references public.empresas (id) on delete cascade,
    credor_id         bigint references public.credores (id) on delete cascade,     -- nulo = empresa toda
    desconto_max_pct  numeric(5, 2) not null check (desconto_max_pct between 0 and 100),
    parcelas_max      int not null check (parcelas_max between 1 and 60),
    parcela_min       numeric(14, 2) not null check (parcela_min >= 0),
    entrada_min       numeric(14, 2) not null default 0 check (entrada_min >= 0),
    validade_dias     int not null default 5 check (validade_dias between 1 and 30),
    ofertas_padrao    jsonb not null default '[]',
    vigente_desde     date not null,
    vigente_ate       date,
    cadastrado_por    uuid default auth.uid() references auth.users (id) on delete set null,
    cadastrado_em     timestamptz not null default now(),
    check (vigente_ate is null or vigente_ate >= vigente_desde),
    check (public.ofertas_alcada_validas(ofertas_padrao, desconto_max_pct, parcelas_max))
);
create unique index if not exists voz_alcada_vigente on public.voz_alcada_carteira (empresa_id, coalesce(credor_id, 0))
    where vigente_ate is null;
comment on table public.voz_alcada_carteira is
    'Alçada do agente por carteira (nulo = empresa toda), com vigência como voz_rotas. É o teto do Generativo, das '
    'ofertas da carteira (alternativa) e também das ofertas do CRM: oferta do CRM acima dela é descartada pelo '
    'executor (código oferta_acima_alcada).';
alter table public.voz_alcada_carteira enable row level security;
drop policy if exists voz_alcada_ver on public.voz_alcada_carteira;
create policy voz_alcada_ver on public.voz_alcada_carteira for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_alcada_carteira from anon;
revoke insert, update, delete on public.voz_alcada_carteira from authenticated;

-- alçada em vigor no dia: a da carteira; sem ela, a da empresa toda (security invoker: o site só acha o que vê)
create or replace function public.alcada_voz_vigente(empresa bigint, credor bigint, dia date default null)
returns public.voz_alcada_carteira
language sql stable set search_path = public as $$
    select a.* from public.voz_alcada_carteira a
     where a.empresa_id = empresa and (a.credor_id = credor or a.credor_id is null)
       and a.vigente_desde <= coalesce(dia, (now() at time zone 'America/Sao_Paulo')::date)
       and (a.vigente_ate is null or a.vigente_ate >= coalesce(dia, (now() at time zone 'America/Sao_Paulo')::date))
     order by (a.credor_id is null), a.vigente_desde desc limit 1
$$;
revoke all on function public.alcada_voz_vigente(bigint, bigint, date) from public, anon;
grant execute on function public.alcada_voz_vigente(bigint, bigint, date) to authenticated, service_role;

-- ================================================================ 7. FL1 · fluxos, versões e modelos
create table if not exists public.voz_fluxo_modelos (
    codigo       text primary key check (codigo ~ '^[a-z][a-z0-9_]{1,30}$'),
    nome         text not null check (char_length(trim(nome)) between 2 and 60),
    tipo_agente  text not null check (tipo_agente in ('localizador', 'negociador', 'ambos')),
    descricao    text check (char_length(descricao) <= 300),
    definicao    jsonb not null check (public.fluxo_voz_valido(definicao)),
    atualizado_em timestamptz not null default now()
);
comment on table public.voz_fluxo_modelos is 'Modelos para começar um fluxo, mantidos pela equipe MotorCX (voz/fluxo_modelos.py).';
alter table public.voz_fluxo_modelos enable row level security;
drop policy if exists voz_fluxo_modelos_ver on public.voz_fluxo_modelos;
create policy voz_fluxo_modelos_ver on public.voz_fluxo_modelos for select to authenticated using (true);
revoke all on public.voz_fluxo_modelos from anon;
revoke insert, update, delete on public.voz_fluxo_modelos from authenticated;

insert into public.voz_fluxo_modelos (codigo, nome, tipo_agente, descricao, definicao) values
    ('localizador', 'Localizador', 'localizador', 'Confirma o titular e transfere para o discador de vocês. Quase tudo árvore.',
     $m${"esquema": 1, "blocos": [{"id": "N1", "tipo": "abertura", "modo": "arvore", "x": 300, "y": 20, "params": {"fala": "Olá, aqui é a central da {{assessoria}}. Falo com {{primeiro_nome}}?"}, "saidas": [{"rotulo": "Sou eu", "para": "N2", "tipo": "normal", "quando": "titular"}, {"rotulo": "Não é a pessoa", "para": "N6", "tipo": "normal", "quando": "terceiro"}]}, {"id": "N2", "tipo": "identidade", "modo": "cognicao", "x": 300, "y": 180, "params": {"fala": "Para sua segurança, me confirma o dia e o mês do seu nascimento?", "pergunta": "dia_mes_nascimento", "conector_id": null, "tentativas": 2}, "saidas": [{"rotulo": "Confirmou", "para": "N3", "tipo": "normal", "quando": "confirmou"}, {"rotulo": "Não confirmou", "para": "N6", "tipo": "normal", "quando": "nao_confirmou"}, {"rotulo": "Conector falhou", "para": "N9", "tipo": "falha", "quando": "falhou"}]}, {"id": "N3", "tipo": "pergunta", "modo": "arvore", "x": 300, "y": 360, "params": {"fala": "Obrigada. Posso transferir você agora para um atendente da {{assessoria}}?", "tentativas": 1, "opcoes": [{"codigo": "sim", "rotulo": "Pode transferir"}, {"codigo": "nao", "rotulo": "Agora não"}]}, "saidas": [{"rotulo": "Pode transferir", "para": "N4", "tipo": "normal", "quando": "sim"}, {"rotulo": "Agora não", "para": "N5", "tipo": "normal", "quando": "nao"}, {"rotulo": "Sem resposta", "para": "N4", "tipo": "normal", "quando": "sem_resposta"}]}, {"id": "N4", "tipo": "transferir", "modo": "arvore", "x": 80, "y": 540, "params": {"fala": "Vou passar você para um atendente agora, só um instante.", "motivo": "cpc"}, "saidas": []}, {"id": "N5", "tipo": "retorno", "modo": "cognicao", "x": 300, "y": 540, "params": {"fala": "Sem problema. Quando fica melhor para falarmos?", "dias_max": 7}, "saidas": [{"rotulo": "Agendou", "para": "N7", "tipo": "normal", "quando": "agendou"}, {"rotulo": "Não agendou", "para": "N8", "tipo": "normal", "quando": "nao_agendou"}]}, {"id": "N6", "tipo": "encerrar", "modo": "arvore", "x": 560, "y": 180, "titulo": "Encerrar · recado neutro", "params": {"fala": "Peço que {{primeiro_nome}} retorne a ligação para a {{assessoria}}. Obrigada.", "resultado": "recado"}, "saidas": []}, {"id": "N7", "tipo": "encerrar", "modo": "arvore", "x": 300, "y": 720, "params": {"fala": "Combinado, eu ligo nesse horário. Até lá!", "resultado": "retorno_agendado"}, "saidas": []}, {"id": "N8", "tipo": "encerrar", "modo": "arvore", "x": 560, "y": 720, "params": {"fala": "Obrigada pela atenção. Até logo.", "resultado": "cpc"}, "saidas": []}, {"id": "N9", "tipo": "transferir", "modo": "arvore", "x": 560, "y": 360, "titulo": "Transferir · atendente", "params": {"fala": "Vou passar você para um atendente agora, só um instante.", "motivo": "pedido_humano"}, "saidas": []}]}$m$::jsonb),
    ('negociador', 'Negociador', 'negociador', 'Confirma o titular, entende a intenção, busca ofertas no CRM e negocia.',
     $m${"esquema": 1, "blocos": [{"id": "N1", "tipo": "abertura", "modo": "arvore", "x": 480, "y": 20, "params": {"fala": "Olá, aqui é a central da {{assessoria}}. Falo com {{primeiro_nome}}?"}, "saidas": [{"rotulo": "Sou eu", "para": "N2", "tipo": "normal", "quando": "titular"}, {"rotulo": "Não é a pessoa", "para": "N14", "tipo": "normal", "quando": "terceiro"}]}, {"id": "N2", "tipo": "identidade", "modo": "cognicao", "x": 480, "y": 180, "params": {"fala": "Para sua segurança, me confirma o dia e o mês do seu nascimento?", "pergunta": "dia_mes_nascimento", "conector_id": null, "tentativas": 2}, "saidas": [{"rotulo": "Confirmou", "para": "N3", "tipo": "normal", "quando": "confirmou"}, {"rotulo": "Não confirmou", "para": "N14", "tipo": "normal", "quando": "nao_confirmou"}, {"rotulo": "Conector falhou", "para": "N13", "tipo": "falha", "quando": "falhou"}]}, {"id": "N3", "tipo": "intencao", "modo": "cognicao", "x": 480, "y": 360, "params": {"fala": "Obrigada. Consta {{saldo}} em aberto com {{credor}}. Como fica melhor para você resolver?", "intencoes": ["quero_negociar", "ja_paguei", "nao_reconheco", "sem_dinheiro"], "exemplos": {"quero_negociar": ["quero parcelar", "tem desconto?"], "ja_paguei": ["já paguei"]}, "confianca_min": 0.7, "tentativas": 2, "entidades": ["data", "parcelas"]}, "saidas": [{"rotulo": "Quer negociar", "para": "N4", "tipo": "normal", "quando": "quero_negociar"}, {"rotulo": "Já paguei", "para": "N8", "tipo": "normal", "quando": "ja_paguei"}, {"rotulo": "Não reconheço", "para": "N10", "tipo": "normal", "quando": "nao_reconheco"}, {"rotulo": "Sem dinheiro agora", "para": "N9", "tipo": "normal", "quando": "sem_dinheiro"}, {"rotulo": "Não entendi 2×", "para": "N13", "tipo": "normal", "quando": "nao_entendido"}]}, {"id": "N4", "tipo": "conector", "modo": "sistema", "x": 20, "y": 600, "params": {"conector_id": null, "fala_espera": "Um instante, vou ver as condições para você."}, "saidas": [{"rotulo": "Respondeu", "para": "N15", "tipo": "normal", "quando": "respondeu"}, {"rotulo": "Falhou", "para": "N6", "tipo": "falha", "quando": "falhou"}]}, {"id": "N15", "tipo": "condicao", "modo": "sistema", "x": 20, "y": 780, "params": {"campo": "ofertas_quantidade", "op": ">=", "valor": 1}, "saidas": [{"rotulo": "Sim", "para": "N5", "tipo": "normal", "quando": "sim"}, {"rotulo": "Nenhuma oferta", "para": "N13", "tipo": "normal", "quando": "nao"}]}, {"id": "N6", "tipo": "oferta", "modo": "cognicao", "x": 250, "y": 780, "titulo": "Oferta da carteira", "params": {"origem": "carteira", "fala": "Consigo para você {{oferta.parcelas}} parcelas de {{oferta.valor_parcela}}, com vencimento em {{oferta.vencimento}}. Fica bom?"}, "saidas": [{"rotulo": "Aceitou", "para": "N7", "tipo": "normal", "quando": "aceitou"}, {"rotulo": "Quer outra condição", "para": "N5", "tipo": "normal", "quando": "quer_outra"}, {"rotulo": "Recusou", "para": "N9", "tipo": "normal", "quando": "recusou"}]}, {"id": "N5", "tipo": "generativa", "modo": "generativo", "x": 20, "y": 980, "titulo": "Negociar dentro das ofertas", "params": {"objetivo": "Fechar um acordo usando uma das ofertas recebidas. Comece pela que tem menor parcela. Se a pessoa pedir algo fora das ofertas, explique o limite uma vez; se insistir, devolva por fora_alcada.", "tom": ["cordial", "frases_curtas", "sem_giria", "nao_pressiona"], "max_turnos": 8, "ferramentas": ["apresentar_oferta", "registrar_promessa", "agendar_retorno", "consultar_base", "transferir_humano", "encerrar_chamada"], "contrapropostas_max": 2}, "saidas": [{"rotulo": "Fechou acordo", "para": "N7", "tipo": "devolve", "quando": "fechou_acordo"}, {"rotulo": "Contestou", "para": "N10", "tipo": "devolve", "quando": "contestou"}, {"rotulo": "Sem acordo", "para": "N9", "tipo": "devolve", "quando": "sem_acordo"}, {"rotulo": "Fora da alçada", "para": "N13", "tipo": "devolve", "quando": "fora_alcada"}]}, {"id": "N7", "tipo": "registrar", "modo": "sistema", "x": 20, "y": 1200, "params": {"registra": "acordo_crm", "conectores": [null, null]}, "saidas": [{"rotulo": "Registrado", "para": "N11", "tipo": "normal", "quando": "registrado"}, {"rotulo": "CRM falhou", "para": "N13", "tipo": "falha", "quando": "falhou"}]}, {"id": "N11", "tipo": "link", "modo": "arvore", "x": 250, "y": 1200, "params": {"canal": "whatsapp_sms", "fala": "Acabei de mandar o link do pagamento no seu WhatsApp."}, "saidas": [{"rotulo": "Enviado", "para": "N12", "tipo": "normal", "quando": "enviado"}, {"rotulo": "Não enviou", "para": "N12", "tipo": "falha", "quando": "falhou"}]}, {"id": "N12", "tipo": "encerrar", "modo": "arvore", "x": 480, "y": 1200, "titulo": "Encerrar · acordo", "params": {"fala": "Obrigada pela atenção. Até logo.", "resultado": "promessa", "codigo": "acordo_registrado"}, "saidas": []}, {"id": "N8", "tipo": "pergunta", "modo": "arvore", "x": 480, "y": 600, "titulo": "Pergunta · já paguei", "params": {"fala": "Em que data você pagou?", "tentativas": 1, "opcoes": [{"codigo": "informou_data", "rotulo": "Informou a data"}, {"codigo": "nao_lembra", "rotulo": "Não lembra", "exemplos": ["não lembro", "não sei"]}]}, "saidas": [{"rotulo": "Informou a data", "para": "N16", "tipo": "normal", "quando": "informou_data"}, {"rotulo": "Não lembra", "para": "N13", "tipo": "normal", "quando": "nao_lembra"}, {"rotulo": "Sem resposta", "para": "N13", "tipo": "normal", "quando": "sem_resposta"}]}, {"id": "N16", "tipo": "encerrar", "modo": "arvore", "x": 480, "y": 780, "titulo": "Encerrar · alega pagamento", "params": {"fala": "Obrigada. Vou registrar e a equipe confere o pagamento.", "resultado": "recusa", "codigo": "alega_pagamento"}, "saidas": []}, {"id": "N10", "tipo": "transferir", "modo": "arvore", "x": 710, "y": 600, "titulo": "Transferir · contestação", "params": {"fala": "Vou passar você para um atendente agora, só um instante.", "motivo": "contestacao"}, "saidas": []}, {"id": "N9", "tipo": "retorno", "modo": "cognicao", "x": 940, "y": 600, "params": {"fala": "Quando fica melhor eu ligar de novo?", "dias_max": 7}, "saidas": [{"rotulo": "Agendou", "para": "N17", "tipo": "normal", "quando": "agendou"}, {"rotulo": "Não agendou", "para": "N13", "tipo": "normal", "quando": "nao_agendou"}]}, {"id": "N17", "tipo": "encerrar", "modo": "arvore", "x": 940, "y": 780, "titulo": "Encerrar · retorno", "params": {"fala": "Combinado, eu ligo nesse horário. Até lá!", "resultado": "retorno_agendado"}, "saidas": []}, {"id": "N13", "tipo": "transferir", "modo": "arvore", "x": 1170, "y": 600, "titulo": "Transferir · atendente", "params": {"fala": "Vou passar você para um atendente agora, só um instante.", "motivo": "pedido_humano"}, "saidas": []}, {"id": "N14", "tipo": "encerrar", "modo": "arvore", "x": 940, "y": 180, "titulo": "Encerrar · recado neutro", "params": {"fala": "Peço que {{primeiro_nome}} retorne para a {{assessoria}}. Obrigada.", "resultado": "recado"}, "saidas": []}]}$m$::jsonb),
    ('ambos', 'Localizador + Negociador', 'ambos', 'Negocia quando há oferta; sem oferta, transfere com CPC.',
     $m${"esquema": 1, "blocos": [{"id": "N1", "tipo": "abertura", "modo": "arvore", "x": 300, "y": 20, "params": {"fala": "Olá, aqui é a central da {{assessoria}}. Falo com {{primeiro_nome}}?"}, "saidas": [{"rotulo": "Sou eu", "para": "N2", "tipo": "normal", "quando": "titular"}, {"rotulo": "Não é a pessoa", "para": "N10", "tipo": "normal", "quando": "terceiro"}]}, {"id": "N2", "tipo": "identidade", "modo": "cognicao", "x": 300, "y": 180, "params": {"fala": "Para sua segurança, me confirma o dia e o mês do seu nascimento?", "pergunta": "dia_mes_nascimento", "conector_id": null, "tentativas": 2}, "saidas": [{"rotulo": "Confirmou", "para": "N3", "tipo": "normal", "quando": "confirmou"}, {"rotulo": "Não confirmou", "para": "N10", "tipo": "normal", "quando": "nao_confirmou"}, {"rotulo": "Conector falhou", "para": "N11", "tipo": "falha", "quando": "falhou"}]}, {"id": "N3", "tipo": "conector", "modo": "sistema", "x": 300, "y": 360, "params": {"conector_id": null, "fala_espera": "Um instante, vou ver as condições para você."}, "saidas": [{"rotulo": "Respondeu", "para": "N4", "tipo": "normal", "quando": "respondeu"}, {"rotulo": "Falhou", "para": "N9", "tipo": "falha", "quando": "falhou"}]}, {"id": "N4", "tipo": "condicao", "modo": "sistema", "x": 300, "y": 540, "params": {"campo": "ofertas_quantidade", "op": ">=", "valor": 1}, "saidas": [{"rotulo": "Tem oferta", "para": "N5", "tipo": "normal", "quando": "sim"}, {"rotulo": "Sem oferta", "para": "N9", "tipo": "normal", "quando": "nao"}]}, {"id": "N5", "tipo": "generativa", "modo": "generativo", "x": 300, "y": 720, "params": {"objetivo": "Apresentar as ofertas recebidas e fechar um acordo com uma delas. Se a pessoa não quiser negociar agora, devolva por sem_acordo para transferir com o titular na linha.", "tom": ["cordial", "frases_curtas", "nao_pressiona"], "max_turnos": 8, "ferramentas": ["apresentar_oferta", "consultar_base", "transferir_humano", "encerrar_chamada"], "contrapropostas_max": 2}, "saidas": [{"rotulo": "Fechou acordo", "para": "N6", "tipo": "devolve", "quando": "fechou_acordo"}, {"rotulo": "Sem acordo", "para": "N9", "tipo": "devolve", "quando": "sem_acordo"}, {"rotulo": "Contestou", "para": "N8", "tipo": "devolve", "quando": "contestou"}]}, {"id": "N6", "tipo": "registrar", "modo": "sistema", "x": 80, "y": 900, "params": {"registra": "promessa_motorcx", "conectores": []}, "saidas": [{"rotulo": "Registrado", "para": "N7", "tipo": "normal", "quando": "registrado"}, {"rotulo": "Falhou", "para": "N9", "tipo": "falha", "quando": "falhou"}]}, {"id": "N7", "tipo": "encerrar", "modo": "arvore", "x": 80, "y": 1080, "params": {"fala": "Combinado. Obrigada pela atenção, até logo.", "resultado": "promessa"}, "saidas": []}, {"id": "N8", "tipo": "transferir", "modo": "arvore", "x": 560, "y": 900, "params": {"fala": "Vou passar você para um atendente agora, só um instante.", "motivo": "contestacao"}, "saidas": []}, {"id": "N9", "tipo": "transferir", "modo": "arvore", "x": 560, "y": 540, "params": {"fala": "Vou passar você para um atendente agora, só um instante.", "motivo": "cpc"}, "saidas": []}, {"id": "N10", "tipo": "encerrar", "modo": "arvore", "x": 560, "y": 180, "titulo": "Encerrar · recado neutro", "params": {"fala": "Peço que {{primeiro_nome}} retorne a ligação para a {{assessoria}}. Obrigada.", "resultado": "recado"}, "saidas": []}, {"id": "N11", "tipo": "transferir", "modo": "arvore", "x": 760, "y": 180, "titulo": "Transferir · atendente", "params": {"fala": "Vou passar você para um atendente agora, só um instante.", "motivo": "pedido_humano"}, "saidas": []}]}$m$::jsonb),
    ('branco', 'Em branco', 'negociador', 'Só Abertura, Confirmar identidade, Encerrar e Transferir. As travas já vêm valendo.',
     $m${"esquema": 1, "blocos": [{"id": "N1", "tipo": "abertura", "modo": "arvore", "x": 300, "y": 20, "params": {"fala": "Olá, aqui é a central da {{assessoria}}. Falo com {{primeiro_nome}}?"}, "saidas": [{"rotulo": "Sou eu", "para": "N2", "tipo": "normal", "quando": "titular"}, {"rotulo": "Não é a pessoa", "para": "N4", "tipo": "normal", "quando": "terceiro"}]}, {"id": "N2", "tipo": "identidade", "modo": "cognicao", "x": 300, "y": 180, "params": {"fala": "Para sua segurança, me confirma o dia e o mês do seu nascimento?", "pergunta": "dia_mes_nascimento", "conector_id": null, "tentativas": 2}, "saidas": [{"rotulo": "Confirmou", "para": "N3", "tipo": "normal", "quando": "confirmou"}, {"rotulo": "Não confirmou", "para": "N4", "tipo": "normal", "quando": "nao_confirmou"}, {"rotulo": "Conector falhou", "para": "N5", "tipo": "falha", "quando": "falhou"}]}, {"id": "N3", "tipo": "encerrar", "modo": "arvore", "x": 300, "y": 360, "params": {"fala": "Obrigada pela atenção. Até logo.", "resultado": "identidade_confirmada"}, "saidas": []}, {"id": "N4", "tipo": "encerrar", "modo": "arvore", "x": 560, "y": 180, "titulo": "Encerrar · recado neutro", "params": {"fala": "Peço que {{primeiro_nome}} retorne a ligação para a {{assessoria}}. Obrigada.", "resultado": "recado"}, "saidas": []}, {"id": "N5", "tipo": "transferir", "modo": "arvore", "x": 560, "y": 360, "titulo": "Transferir · atendente", "params": {"fala": "Vou passar você para um atendente agora, só um instante.", "motivo": "pedido_humano"}, "saidas": []}]}$m$::jsonb)
on conflict (codigo) do update set nome = excluded.nome, tipo_agente = excluded.tipo_agente,
    descricao = excluded.descricao, definicao = excluded.definicao, atualizado_em = now();

create table if not exists public.voz_fluxos (
    id                 bigint generated always as identity primary key,
    empresa_id         bigint not null references public.empresas (id) on delete cascade,
    credor_id          bigint references public.credores (id) on delete cascade,     -- nulo = empresa toda
    nome               text not null check (char_length(trim(nome)) between 2 and 60),
    tipo_agente        text not null default 'negociador' check (tipo_agente in ('localizador', 'negociador', 'ambos')),
    modelo_origem      text check (modelo_origem ~ '^[a-z0-9_]{1,40}$'),
    roteiro_origem_id  bigint unique references public.voz_roteiros (id) on delete set null,
    criado_por         uuid default auth.uid() references auth.users (id) on delete set null,
    criado_em          timestamptz not null default now(),
    unique (id, empresa_id)
);
create unique index if not exists voz_fluxos_nome on public.voz_fluxos (empresa_id, coalesce(credor_id, 0), nome);
comment on column public.voz_fluxos.roteiro_origem_id is 'Roteiro (voz_roteiros) que virou este fluxo na migração do SQL 58.';
alter table public.voz_fluxos enable row level security;
drop policy if exists voz_fluxos_ver on public.voz_fluxos;
create policy voz_fluxos_ver on public.voz_fluxos for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_fluxos from anon;
revoke insert, update, delete on public.voz_fluxos from authenticated;

create table if not exists public.voz_fluxo_versoes (
    id             bigint generated always as identity primary key,
    fluxo_id       bigint not null,
    empresa_id     bigint not null,
    credor_id      bigint,                                    -- cópia do fluxo (uma versão em uso por carteira)
    versao         int not null check (versao >= 1),
    situacao       text not null default 'rascunho' check (situacao in ('rascunho', 'aprovado_empresa', 'em_uso', 'arquivado')),
    definicao      jsonb not null,
    esquema_versao int generated always as (((definicao ->> 'esquema')::numeric)::int) stored,
    hash           text generated always as (encode(sha256(definicao::text::bytea), 'hex')) stored,
    motivo         text check (motivo is null or char_length(motivo) <= 300),
    parecer        text check (parecer is null or char_length(parecer) <= 1000),
    publicado_ref  text check (publicado_ref ~ '^[A-Za-z0-9_\-]{4,100}$'),
    criado_por     uuid default auth.uid() references auth.users (id) on delete set null,
    criado_em      timestamptz not null default now(),
    atualizado_em  timestamptz not null default now(),
    aprovado_por   uuid references auth.users (id) on delete set null,
    aprovado_em    timestamptz,
    em_uso_por     uuid references auth.users (id) on delete set null,
    em_uso_em      timestamptz,
    arquivado_em   timestamptz,
    unique (fluxo_id, versao),
    foreign key (fluxo_id, empresa_id) references public.voz_fluxos (id, empresa_id) on delete cascade,
    check (public.fluxo_voz_forma_ok(definicao)),
    check (situacao = 'rascunho' or public.fluxo_voz_valido(definicao)),
    check (situacao = 'rascunho' or aprovado_em is not null)
);
create unique index if not exists voz_fluxo_versoes_em_uso on public.voz_fluxo_versoes (fluxo_id) where situacao = 'em_uso';
create unique index if not exists voz_fluxo_versoes_em_uso_carteira on public.voz_fluxo_versoes (empresa_id, coalesce(credor_id, 0))
    where situacao = 'em_uso';
comment on table public.voz_fluxo_versoes is
    'Versões do fluxo: rascunho → aprovado_empresa → em_uso → arquivado. Uma em uso por fluxo e por carteira; vale até a '
    'próxima entrar. Rascunho só precisa da forma (fluxo_voz_forma_ok); daí em diante o fluxo tem de ser válido. '
    'A chamada guarda fluxo_versao_id ao começar: trocar de versão nunca muda uma ligação em curso.';
comment on column public.voz_fluxo_versoes.publicado_ref is 'ID do agente/workflow publicado na ElevenLabs (quando houver).';
alter table public.voz_fluxo_versoes enable row level security;
drop policy if exists voz_fluxo_versoes_ver on public.voz_fluxo_versoes;
create policy voz_fluxo_versoes_ver on public.voz_fluxo_versoes for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_fluxo_versoes from anon;
revoke insert, update, delete on public.voz_fluxo_versoes from authenticated;

create or replace function public.copiar_carteira_fluxo_voz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    select f.credor_id into new.credor_id from public.voz_fluxos f where f.id = new.fluxo_id;
    return new;
end $$;
revoke all on function public.copiar_carteira_fluxo_voz() from public, anon, authenticated;
drop trigger if exists copiar_carteira_fluxo_voz on public.voz_fluxo_versoes;
create trigger copiar_carteira_fluxo_voz before insert on public.voz_fluxo_versoes
    for each row execute function public.copiar_carteira_fluxo_voz();

-- ================================================================ 8. FL8 · base de respostas do Generativo
create table if not exists public.voz_base_respostas (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    fluxo_versao_id  bigint not null references public.voz_fluxo_versoes (id) on delete cascade,
    bloco_id         text not null check (bloco_id ~ '^N[0-9]{1,3}$'),
    pergunta         text not null check (char_length(trim(pergunta)) between 3 and 300),
    resposta         text not null check (char_length(trim(resposta)) between 3 and 600 and resposta !~ '[0-9]{9,}'),
    criado_por       uuid default auth.uid() references auth.users (id) on delete set null,
    criado_em        timestamptz not null default now(),
    revisado_por     uuid references auth.users (id) on delete set null,
    revisado_em      timestamptz
);
create index if not exists voz_base_respostas_versao on public.voz_base_respostas (fluxo_versao_id, bloco_id);
comment on table public.voz_base_respostas is 'Perguntas e respostas do bloco generativo. Só as revisadas vão ao executor.';
alter table public.voz_base_respostas enable row level security;
drop policy if exists voz_base_respostas_ver on public.voz_base_respostas;
create policy voz_base_respostas_ver on public.voz_base_respostas for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_base_respostas from anon;
revoke insert, update, delete on public.voz_base_respostas from authenticated;

-- ================================================================ 9. casos de teste guardados (decisão 5)
-- falas fictícias: 1 a 30, cada uma com 1 a 300 caracteres, sem 9+ dígitos seguidos (documento, telefone) nem @
create or replace function public.falas_teste_voz_ok(f text[]) returns boolean
language sql immutable parallel safe as $$
    select coalesce(cardinality(f) between 1 and 30 and array_to_string(f, chr(10)) !~ '[0-9]{9,}'
                    and array_to_string(f, chr(10)) !~ '@'
                    and not exists (select 1 from unnest(f) x where x is null or char_length(x) not between 1 and 300), false)
$$;
create table if not exists public.voz_fluxo_casos_teste (
    id                  bigint generated always as identity primary key,
    empresa_id          bigint not null,
    fluxo_id            bigint not null,
    nome                text not null check (char_length(trim(nome)) between 2 and 80),
    falas               text[] not null check (public.falas_teste_voz_ok(falas)),
    caminho_esperado    text[] not null check (cardinality(caminho_esperado) between 1 and 200
                                               and array_to_string(caminho_esperado, ',') ~ '^N[0-9]{1,3}(,N[0-9]{1,3})*$'),
    resultado_esperado  text check (resultado_esperado ~ '^[a-z][a-z0-9_]{1,40}$'),
    conectores_falham   bigint[] not null default '{}' check (cardinality(conectores_falham) <= 10),
    ativo               boolean not null default true,
    criado_por          uuid default auth.uid() references auth.users (id) on delete set null,
    criado_em           timestamptz not null default now(),
    atualizado_em       timestamptz not null default now(),
    unique (fluxo_id, nome),
    unique (id, empresa_id),
    foreign key (fluxo_id, empresa_id) references public.voz_fluxos (id, empresa_id) on delete cascade
);
comment on table public.voz_fluxo_casos_teste is
    'Casos do simulador de texto (falas fictícias da pessoa e caminho esperado), rodados a cada nova versão do fluxo. '
    'Caso que falhou numa versão segura a aprovação dela. Sem dado pessoal: 9+ dígitos seguidos e @ são recusados.';
comment on column public.voz_fluxo_casos_teste.conectores_falham is 'Conectores que o simulador faz falhar neste caso (ex.: Buscar ofertas → alternativa).';

create table if not exists public.voz_fluxo_casos_resultados (
    caso_id         bigint not null references public.voz_fluxo_casos_teste (id) on delete cascade,
    fluxo_versao_id bigint not null references public.voz_fluxo_versoes (id) on delete cascade,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    passou          boolean not null,
    caminho_obtido  text[] not null check (cardinality(caminho_obtido) <= 200
                                           and array_to_string(caminho_obtido, ',') ~ '^(N[0-9]{1,3}(,N[0-9]{1,3})*)?$'),
    resultado_obtido text check (resultado_obtido ~ '^[a-z][a-z0-9_]{1,40}$'),
    executado_em    timestamptz not null default now(),
    primary key (caso_id, fluxo_versao_id)
);
alter table public.voz_fluxo_casos_teste enable row level security;
alter table public.voz_fluxo_casos_resultados enable row level security;
drop policy if exists voz_fluxo_casos_ver on public.voz_fluxo_casos_teste;
create policy voz_fluxo_casos_ver on public.voz_fluxo_casos_teste for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists voz_fluxo_casos_res_ver on public.voz_fluxo_casos_resultados;
create policy voz_fluxo_casos_res_ver on public.voz_fluxo_casos_resultados for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_fluxo_casos_teste, public.voz_fluxo_casos_resultados from anon;
revoke insert, update, delete on public.voz_fluxo_casos_teste, public.voz_fluxo_casos_resultados from authenticated;

-- ================================================================ 10. FL5 · chamadas aos conectores (só códigos)
alter table public.voz_chamadas add column if not exists fluxo_versao_id bigint
    references public.voz_fluxo_versoes (id) on delete set null;
alter table public.voz_chamadas add column if not exists bloco_final text check (bloco_final ~ '^N[0-9]{1,3}$');
create index if not exists voz_chamadas_fluxo on public.voz_chamadas (fluxo_versao_id, ocorrido_em) where fluxo_versao_id is not null;

create table if not exists public.crm_chamadas (
    id                   bigint generated always as identity primary key,
    empresa_id           bigint not null references public.empresas (id) on delete cascade,
    conector_id          bigint references public.crm_conectores (id) on delete set null,
    conector_versao      int check (conector_versao >= 1),
    chamada_id           bigint references public.voz_chamadas (id) on delete cascade,    -- nulo = teste/simulador
    id_chamada           text check (id_chamada ~ '^[A-Za-z0-9_.:\-]{4,80}$'),
    id_cliente           text check (char_length(id_cliente) between 1 and 60),
    fluxo_versao_id      bigint references public.voz_fluxo_versoes (id) on delete set null,
    bloco_id             text check (bloco_id ~ '^N[0-9]{1,3}$'),
    ocorrido_em          timestamptz not null default now(),
    tentativa            int not null default 1 check (tentativa between 1 and 3),
    http_status          int check (http_status between 100 and 599),
    classe               text not null check (classe in ('ok', 'tempo', 'http_4xx', 'http_5xx', 'mapa_invalido', 'recusado')),
    latencia_ms          int check (latencia_ms between 0 and 60000),
    resultado_codigo     text check (resultado_codigo = any (public.codigos_conector_voz())),
    ofertas_acima_alcada int not null default 0 check (ofertas_acima_alcada between 0 and 50),
    usou_alternativa     boolean not null default false
);
create index if not exists crm_chamadas_conector on public.crm_chamadas (conector_id, ocorrido_em desc);
create index if not exists crm_chamadas_empresa on public.crm_chamadas (empresa_id, ocorrido_em desc);
comment on table public.crm_chamadas is
    'Uma linha por tentativa de conector. Sem corpo e sem texto livre: só classe, status, tempo e código fechado. '
    'Gravada pela VM; apagada com a chamada e na retenção da empresa (apagar_voz_expirada).';
comment on column public.crm_chamadas.ofertas_acima_alcada is
    'Ofertas do CRM descartadas pelo executor por passarem da alçada (decisão 2). Todas descartadas = oferta_acima_alcada.';
alter table public.crm_chamadas enable row level security;
drop policy if exists crm_chamadas_ver on public.crm_chamadas;
create policy crm_chamadas_ver on public.crm_chamadas for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.crm_chamadas from anon;
revoke insert, update, delete on public.crm_chamadas from authenticated;

-- saúde por conector nas últimas 24 h (p50, p95, taxa de erro, volume)
create or replace view public.crm_conector_saude with (security_invoker = true) as
select c.id as conector_id, c.empresa_id, c.nome, c.situacao,
       count(h.id) as volume_24h,
       percentile_disc(0.5) within group (order by h.latencia_ms) as p50_ms,
       percentile_disc(0.95) within group (order by h.latencia_ms) as p95_ms,
       round(100.0 * count(h.id) filter (where h.classe <> 'ok') / nullif(count(h.id), 0), 1) as erro_pct,
       max(h.ocorrido_em) as ultima
  from public.crm_conectores c
  left join public.crm_chamadas h on h.conector_id = c.id and h.ocorrido_em > now() - interval '24 hours'
 group by c.id, c.empresa_id, c.nome, c.situacao;
grant select on public.crm_conector_saude to authenticated;
revoke all on public.crm_conector_saude from anon;

-- ================================================================ 11. FL7 · passos por bloco e métricas do dia
create table if not exists public.voz_fluxo_passos (
    id                bigint generated always as identity primary key,
    empresa_id        bigint not null references public.empresas (id) on delete cascade,
    chamada_id        bigint references public.voz_chamadas (id) on delete cascade,
    id_chamada        text not null check (id_chamada ~ '^[A-Za-z0-9_.:\-]{4,80}$'),
    fluxo_versao_id   bigint not null references public.voz_fluxo_versoes (id) on delete cascade,
    ordem             int not null check (ordem between 1 and 200),
    bloco_id          text not null check (bloco_id ~ '^N[0-9]{1,3}$'),
    modo              text not null check (modo in ('arvore', 'cognicao', 'generativo', 'sistema')),
    entrou_em         timestamptz not null default now(),
    saida_quando      text check (saida_quando ~ '^[a-z][a-z0-9_]{1,40}$'),
    intencao          text check (intencao ~ '^[a-z][a-z0-9_]{1,40}$'),
    confianca_faixa   text check (confianca_faixa in ('baixa', 'media', 'alta')),
    motivo_devolucao  text check (motivo_devolucao ~ '^[a-z][a-z0-9_]{1,40}$'),
    trava             text check (trava in ('nao_me_ligue', 'pedido_humano', 'senha_cartao', 'valor_antes_identidade',
                                            'terceiro', 'alcada', 'oferta_inventada', 'repeticao')),
    turnos            int check (turnos between 0 and 200),
    unique (empresa_id, id_chamada, ordem)
);
create index if not exists voz_fluxo_passos_versao on public.voz_fluxo_passos (fluxo_versao_id, entrou_em);
comment on table public.voz_fluxo_passos is
    'Um evento por bloco da ligação (entrou, saiu por qual `quando`, intenção, motivo de devolução, trava). Só códigos. '
    'Gravada pela VM no tick() do orquestrador; apagada com a chamada e na retenção da empresa.';
comment on column public.voz_fluxo_passos.saida_quando is 'O `quando` da saída que o executor seguiu (o rótulo é da tela).';

-- {código: n}: só códigos fechados e contagens
create or replace function public.contagem_codigos_ok(j jsonb) returns boolean
language sql immutable parallel safe as $$
    select coalesce(jsonb_typeof(j) = 'object'
                    and not exists (select 1 from jsonb_each(j) e
                                     where e.key !~ '^[a-z][a-z0-9_]{1,40}$' or jsonb_typeof(e.value) <> 'number'), false)
$$;
create table if not exists public.voz_fluxo_metricas_dia (
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    fluxo_versao_id bigint not null references public.voz_fluxo_versoes (id) on delete cascade,
    dia             date not null,
    bloco_id        text not null check (bloco_id ~ '^N[0-9]{1,3}$'),
    chegaram        int not null default 0 check (chegaram >= 0),
    saidas          jsonb not null default '{}' check (public.contagem_codigos_ok(saidas)),
    turnos_medio    numeric(6, 2) check (turnos_medio >= 0),
    primary key (fluxo_versao_id, dia, bloco_id)
);
create table if not exists public.voz_fluxo_intencoes_dia (
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    fluxo_versao_id bigint not null references public.voz_fluxo_versoes (id) on delete cascade,
    dia             date not null,
    bloco_id        text not null check (bloco_id ~ '^N[0-9]{1,3}$'),
    intencao        text not null check (intencao ~ '^[a-z][a-z0-9_]{1,40}$'),
    n               int not null check (n >= 0),
    primary key (fluxo_versao_id, dia, bloco_id, intencao)
);
comment on table public.voz_fluxo_metricas_dia is 'Funil por bloco (agregado pela VM toda noite). Sem dado por cliente: fica depois dos passos.';
do $$
declare t text;
begin
    foreach t in array array['voz_fluxo_passos', 'voz_fluxo_metricas_dia', 'voz_fluxo_intencoes_dia'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists %I on public.%I', t || '_ver', t);
        execute format('create policy %I on public.%I for select to authenticated '
                       'using (empresa_id in (select public.minhas_empresas()))', t || '_ver', t);
        execute format('revoke all on public.%I from anon', t);
        execute format('revoke insert, update, delete on public.%I from authenticated', t);
    end loop;
end $$;

-- retenção: passos e chamadas de conector saem junto com os códigos da chamada (mínimo 90 dias)
select pg_temp.trocar('public.apagar_voz_expirada()',
    '    return jsonb_build_object(''gravacoes'', g, ''codigos'', c + c2);',
    '    delete from public.voz_fluxo_passos p
     where p.entrou_em < now() - make_interval(days => coalesce((select cf.retencao_dias from public.voz_config cf
                                                                  where cf.empresa_id = p.empresa_id), 90));
    delete from public.crm_chamadas h
     where h.ocorrido_em < now() - make_interval(days => coalesce((select cf.retencao_dias from public.voz_config cf
                                                                    where cf.empresa_id = h.empresa_id), 90));
    return jsonb_build_object(''gravacoes'', g, ''codigos'', c + c2);');

-- ================================================================ 11b. identidade só pelo CRM (decisão do dono)
-- A conferência pelo dado da carga na VM foi descartada: a identidade é confirmada só pelo conector validar_cadastro.
-- Quem aplicou uma versão anterior deste SQL perde a coluna e a função.
drop function if exists public.liberar_identidade_dado_carga(bigint, boolean);
alter table public.voz_config drop column if exists identidade_dado_carga_vm;

-- ================================================================ 12. pendências de contexto (seguram aprovação e uso)
-- identidade_sem_conferencia:ID Confirmar identidade sem o conector de validação do CRM (só ele confere)
-- conector_inativo:ID   conector não escolhido, de outra empresa ou fora de 'ativo'
-- conector_finalidade:ID identidade → validar_cadastro; oferta → buscar_ofertas; registrar → acordo/boleto/link
-- sem_alcada            fluxo que oferece sem alçada vigente (decisão 2: ela é o teto de toda oferta)
-- intencao_fora_catalogo:ID intenção que não está ativa em voz_intencoes
-- Cópia em voz/fluxo_validador.pendencias().
create or replace function public.fluxo_voz_pendencias(empresa bigint, credor bigint, d jsonb) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
    out text[] := '{}';
    b jsonb; p jsonb; c jsonb; cid bigint; cs jsonb;
    con public.crm_conectores;
    fins text[];
begin
    if not (public.chamada_do_servidor() or empresa in (select public.minhas_empresas())) then
        raise exception 'empresa fora do seu acesso';
    end if;
    if not public.fluxo_voz_valido(d) then
        return public.fluxo_voz_erros(d);
    end if;
    for b in select x from jsonb_array_elements(d -> 'blocos') x loop
        p := b -> 'params';
        if b ->> 'tipo' = 'identidade' and coalesce(jsonb_typeof(p -> 'conector_id'), 'null') = 'null' then
            out := out || ('identidade_sem_conferencia:' || (b ->> 'id'));     -- só o CRM confere a identidade
        end if;
        cs := case
            when b ->> 'tipo' = 'conector' then jsonb_build_array(p -> 'conector_id')
            when b ->> 'tipo' = 'identidade' and jsonb_typeof(p -> 'conector_id') = 'number' then jsonb_build_array(p -> 'conector_id')
            when b ->> 'tipo' = 'oferta' and p ->> 'origem' = 'conector' then jsonb_build_array(p -> 'conector_id')
            when b ->> 'tipo' = 'registrar' and p ->> 'registra' = 'acordo_crm' then
                coalesce(nullif((select jsonb_agg(x) from jsonb_array_elements(coalesce(p -> 'conectores', '[]')) x
                                  where jsonb_typeof(x) = 'number'), '[]'), '[null]'::jsonb)
            else '[]'::jsonb end;
        fins := case b ->> 'tipo' when 'identidade' then array['validar_cadastro'] when 'oferta' then array['buscar_ofertas']
                                 when 'registrar' then array['registrar_acordo', 'gerar_boleto', 'gerar_link'] else null end;
        for c in select x from jsonb_array_elements(cs) x loop
            cid := case when jsonb_typeof(c) = 'number' then (c #>> '{}')::bigint end;
            select * into con from public.crm_conectores k where k.id = cid and k.empresa_id = empresa;
            if con.id is null or con.situacao <> 'ativo' then
                out := out || ('conector_inativo:' || (b ->> 'id'));
            elsif fins is not null and con.finalidade <> all (fins) then
                out := out || ('conector_finalidade:' || (b ->> 'id'));
            end if;
        end loop;
        if b ->> 'tipo' = 'intencao' and exists (
            select 1 from jsonb_array_elements_text(p -> 'intencoes') i
             where not exists (select 1 from public.voz_intencoes v where v.codigo = i and v.ativa)) then
            out := out || ('intencao_fora_catalogo:' || (b ->> 'id'));
        end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(d -> 'blocos') x
                where x ->> 'tipo' = 'oferta'
                   or (x ->> 'tipo' = 'generativa' and x -> 'params' -> 'ferramentas' @> '["apresentar_oferta"]'))
       and not exists (select 1 from public.voz_alcada_carteira a
                        where a.empresa_id = empresa and (a.credor_id = credor or a.credor_id is null)
                          and a.vigente_desde <= (now() at time zone 'America/Sao_Paulo')::date
                          and (a.vigente_ate is null or a.vigente_ate >= (now() at time zone 'America/Sao_Paulo')::date)) then
        out := out || 'sem_alcada'::text;
    end if;
    return array(select distinct x collate "C" from unnest(out) x order by 1);
end $$;
revoke all on function public.fluxo_voz_pendencias(bigint, bigint, jsonb) from public, anon;
grant execute on function public.fluxo_voz_pendencias(bigint, bigint, jsonb) to authenticated, service_role;

-- o que segura a versão (validador + contexto + casos de teste que falharam nela)
create or replace function public.fluxo_voz_bloqueios(versao bigint) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare v public.voz_fluxo_versoes;
begin
    select * into v from public.voz_fluxo_versoes where id = fluxo_voz_bloqueios.versao;
    if v.id is null or not (public.chamada_do_servidor() or v.empresa_id in (select public.minhas_empresas())) then
        raise exception 'versão não encontrada';
    end if;
    return public.fluxo_voz_pendencias(v.empresa_id, v.credor_id, v.definicao)
        || array(select 'caso_falhou:' || c.id from public.voz_fluxo_casos_resultados r
                   join public.voz_fluxo_casos_teste c on c.id = r.caso_id
                  where r.fluxo_versao_id = fluxo_voz_bloqueios.versao and not r.passou and c.ativo order by c.id);
end $$;
revoke all on function public.fluxo_voz_bloqueios(bigint) from public, anon;
grant execute on function public.fluxo_voz_bloqueios(bigint) to authenticated, service_role;

-- versão em uso da carteira (a da carteira; sem ela, a da empresa toda). O executor pede no começo de cada chamada.
create or replace function public.fluxo_voz_em_uso(empresa bigint, credor bigint)
returns table (versao_id bigint, fluxo_id bigint, versao int, hash text, tipo_agente text, definicao jsonb)
language sql stable security definer set search_path = public as $$
    select v.id, v.fluxo_id, v.versao, v.hash, f.tipo_agente, v.definicao
      from public.voz_fluxo_versoes v join public.voz_fluxos f on f.id = v.fluxo_id
     where v.empresa_id = empresa and v.situacao = 'em_uso' and (v.credor_id = credor or v.credor_id is null)
       and (public.chamada_do_servidor() or public.chamada_da_vm_voz() or empresa in (select public.minhas_empresas()))
     order by (v.credor_id is null) limit 1
$$;
revoke all on function public.fluxo_voz_em_uso(bigint, bigint) from public, anon;
grant execute on function public.fluxo_voz_em_uso(bigint, bigint) to authenticated, service_role;

-- ================================================================ 13. RPCs: fluxo (empresa)
create or replace function public.pode_editar_fluxo_voz(empresa bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select not public.sou_equipe() and empresa in (select public.minhas_empresas()) and public.pode('editar_canais')
$$;
create or replace function public.pode_aprovar_fluxo_voz(empresa bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select not public.sou_equipe() and empresa in (select public.minhas_empresas()) and public.pode('aprovar_roteiro_voz')
$$;
revoke all on function public.pode_editar_fluxo_voz(bigint), public.pode_aprovar_fluxo_voz(bigint) from public, anon;
grant execute on function public.pode_editar_fluxo_voz(bigint), public.pode_aprovar_fluxo_voz(bigint) to authenticated;

-- cria (versao nula: fluxo novo, v1) ou edita. Rascunho edita no lugar; aprovado, em uso ou arquivado vira versão nova
-- (rascunho), com a base de respostas copiada. Devolve o id da versão.
create or replace function public.salvar_fluxo_voz(empresa bigint, credor bigint, nome text, tipo_agente text,
                                                   definicao jsonb, versao bigint default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
    v public.voz_fluxo_versoes;
    fid bigint;
    vid bigint;
begin
    if not public.pode_editar_fluxo_voz(empresa) then
        raise exception 'sem permissão para editar o fluxo do agente virtual';
    end if;
    if credor is not null and not exists (select 1 from public.credores c where c.id = credor and c.empresa_id = empresa) then
        raise exception 'carteira não encontrada';
    end if;
    if not public.fluxo_voz_forma_ok(salvar_fluxo_voz.definicao) then
        raise exception 'fluxo fora do esquema: %', array_to_string(public.fluxo_voz_erros(salvar_fluxo_voz.definicao), ', ');
    end if;
    if salvar_fluxo_voz.versao is null then
        insert into public.voz_fluxos (empresa_id, credor_id, nome, tipo_agente)
        values (empresa, credor, trim(salvar_fluxo_voz.nome), salvar_fluxo_voz.tipo_agente) returning id into fid;
        insert into public.voz_fluxo_versoes (fluxo_id, empresa_id, versao, definicao)
        values (fid, empresa, 1, salvar_fluxo_voz.definicao) returning id into vid;
        return vid;
    end if;
    select x.* into v from public.voz_fluxo_versoes x join public.voz_fluxos f on f.id = x.fluxo_id
     where x.id = salvar_fluxo_voz.versao and x.empresa_id = empresa and f.credor_id is not distinct from credor;
    if v.id is null then
        raise exception 'versão não encontrada';
    end if;
    update public.voz_fluxos f set nome = coalesce(nullif(trim(salvar_fluxo_voz.nome), ''), f.nome),
           tipo_agente = coalesce(salvar_fluxo_voz.tipo_agente, f.tipo_agente)
     where f.id = v.fluxo_id;
    if v.situacao = 'rascunho' then
        update public.voz_fluxo_versoes x set definicao = salvar_fluxo_voz.definicao, atualizado_em = now() where x.id = v.id;
        return v.id;
    end if;
    -- só um rascunho aberto por fluxo: edita o que já existe
    select x.id into vid from public.voz_fluxo_versoes x where x.fluxo_id = v.fluxo_id and x.situacao = 'rascunho'
     order by x.versao desc limit 1;
    if vid is not null then
        raise exception 'já há um rascunho deste fluxo (versão %): edite o rascunho',
            (select x.versao from public.voz_fluxo_versoes x where x.id = vid);
    end if;
    insert into public.voz_fluxo_versoes (fluxo_id, empresa_id, versao, definicao)
    values (v.fluxo_id, empresa, (select max(x.versao) from public.voz_fluxo_versoes x where x.fluxo_id = v.fluxo_id) + 1,
            salvar_fluxo_voz.definicao)
    returning id into vid;
    insert into public.voz_base_respostas (empresa_id, fluxo_versao_id, bloco_id, pergunta, resposta, revisado_por, revisado_em)
    select r.empresa_id, vid, r.bloco_id, r.pergunta, r.resposta, r.revisado_por, r.revisado_em
      from public.voz_base_respostas r where r.fluxo_versao_id = v.id;
    return vid;
end $$;
revoke all on function public.salvar_fluxo_voz(bigint, bigint, text, text, jsonb, bigint) from public, anon;
grant execute on function public.salvar_fluxo_voz(bigint, bigint, text, text, jsonb, bigint) to authenticated;

-- rascunho → aprovado_empresa. O validador e as pendências seguram (a mensagem lista os códigos).
create or replace function public.aprovar_fluxo_voz(versao bigint, parecer text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
    v public.voz_fluxo_versoes;
    pend text[];
begin
    select * into v from public.voz_fluxo_versoes where id = aprovar_fluxo_voz.versao;
    if v.id is null or not public.pode_aprovar_fluxo_voz(v.empresa_id) then
        raise exception 'versão não encontrada ou sem permissão para aprovar o fluxo';
    end if;
    if v.situacao <> 'rascunho' then
        raise exception 'a versão está em %: só rascunho vai para aprovação', replace(v.situacao, '_', ' ');
    end if;
    pend := public.fluxo_voz_bloqueios(versao);
    if cardinality(pend) > 0 then
        raise exception 'o fluxo não pode ir para aprovação: %', array_to_string(pend, ', ');
    end if;
    update public.voz_fluxo_versoes x set situacao = 'aprovado_empresa', aprovado_por = auth.uid(), aprovado_em = now(),
           parecer = coalesce(nullif(trim(aprovar_fluxo_voz.parecer), ''), x.parecer), atualizado_em = now()
     where x.id = aprovar_fluxo_voz.versao;
    return 'aprovado_empresa';
end $$;
revoke all on function public.aprovar_fluxo_voz(bigint, text) from public, anon;
grant execute on function public.aprovar_fluxo_voz(bigint, text) to authenticated;

-- troca atômica da versão em uso da carteira (a anterior vai para o arquivo; nada é apagado)
create or replace function public.trocar_em_uso_fluxo_voz(v public.voz_fluxo_versoes, motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare pend text[];
begin
    perform 1 from public.voz_fluxo_versoes x
     where x.empresa_id = v.empresa_id and x.credor_id is not distinct from v.credor_id for update;
    pend := public.fluxo_voz_bloqueios(v.id);
    if cardinality(pend) > 0 then
        raise exception 'o fluxo não pode entrar em uso: %', array_to_string(pend, ', ');
    end if;
    update public.voz_fluxo_versoes x set situacao = 'arquivado', arquivado_em = now(), atualizado_em = now()
     where x.empresa_id = v.empresa_id and x.credor_id is not distinct from v.credor_id and x.situacao = 'em_uso';
    update public.voz_fluxo_versoes x set situacao = 'em_uso', em_uso_por = auth.uid(), em_uso_em = now(), arquivado_em = null,
           motivo = coalesce(trocar_em_uso_fluxo_voz.motivo, x.motivo), atualizado_em = now()
     where x.id = v.id;
end $$;
revoke all on function public.trocar_em_uso_fluxo_voz(public.voz_fluxo_versoes, text) from public, anon, authenticated;

-- aprovado_empresa → em_uso
create or replace function public.usar_fluxo_voz(versao bigint) returns text
language plpgsql security definer set search_path = public as $$
declare v public.voz_fluxo_versoes;
begin
    select * into v from public.voz_fluxo_versoes where id = usar_fluxo_voz.versao;
    if v.id is null or not public.pode_aprovar_fluxo_voz(v.empresa_id) then
        raise exception 'versão não encontrada ou sem permissão para colocar o fluxo em uso';
    end if;
    if v.situacao <> 'aprovado_empresa' then
        raise exception 'a versão está em %: só a aprovada pela empresa entra em uso', replace(v.situacao, '_', ' ');
    end if;
    perform public.trocar_em_uso_fluxo_voz(v, null);
    return 'em_uso';
end $$;
revoke all on function public.usar_fluxo_voz(bigint) from public, anon;
grant execute on function public.usar_fluxo_voz(bigint) to authenticated;

-- volta uma versão arquivada para uso (vale na próxima ligação), com motivo; a atual vai para o arquivo
create or replace function public.voltar_versao_fluxo_voz(fluxo bigint, versao int, motivo text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v public.voz_fluxo_versoes;
begin
    select x.* into v from public.voz_fluxo_versoes x where x.fluxo_id = fluxo and x.versao = voltar_versao_fluxo_voz.versao;
    if v.id is null or not public.pode_aprovar_fluxo_voz(v.empresa_id) then
        raise exception 'versão não encontrada ou sem permissão para voltar a versão';
    end if;
    if v.situacao <> 'arquivado' then
        raise exception 'só uma versão arquivada volta a ficar em uso';
    end if;
    if motivo is null or char_length(trim(motivo)) not between 5 and 300 then
        raise exception 'diga o motivo (5 a 300 caracteres)';
    end if;
    perform public.trocar_em_uso_fluxo_voz(v, trim(motivo));
    return v.id;
end $$;
revoke all on function public.voltar_versao_fluxo_voz(bigint, int, text) from public, anon;
grant execute on function public.voltar_versao_fluxo_voz(bigint, int, text) to authenticated;

-- copia uma versão para outra carteira da mesma empresa, como rascunho v1 de um fluxo novo
create or replace function public.duplicar_fluxo_voz(versao bigint, credor_destino bigint, nome text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    v public.voz_fluxo_versoes;
    f public.voz_fluxos;
    fid bigint;
    vid bigint;
begin
    select * into v from public.voz_fluxo_versoes where id = duplicar_fluxo_voz.versao;
    if v.id is null or not public.pode_editar_fluxo_voz(v.empresa_id) then
        raise exception 'versão não encontrada ou sem permissão para editar o fluxo';
    end if;
    if credor_destino is not null
       and not exists (select 1 from public.credores c where c.id = credor_destino and c.empresa_id = v.empresa_id) then
        raise exception 'carteira não encontrada';
    end if;
    select * into f from public.voz_fluxos where id = v.fluxo_id;
    insert into public.voz_fluxos (empresa_id, credor_id, nome, tipo_agente, modelo_origem)
    values (v.empresa_id, credor_destino, coalesce(nullif(trim(duplicar_fluxo_voz.nome), ''), f.nome), f.tipo_agente,
            f.modelo_origem)
    returning id into fid;
    insert into public.voz_fluxo_versoes (fluxo_id, empresa_id, versao, definicao, motivo)
    values (fid, v.empresa_id, 1, v.definicao, 'cópia da versão ' || v.versao || ' de ' || f.nome)
    returning id into vid;
    insert into public.voz_base_respostas (empresa_id, fluxo_versao_id, bloco_id, pergunta, resposta)
    select r.empresa_id, vid, r.bloco_id, r.pergunta, r.resposta from public.voz_base_respostas r where r.fluxo_versao_id = v.id;
    return vid;
end $$;
revoke all on function public.duplicar_fluxo_voz(bigint, bigint, text) from public, anon;
grant execute on function public.duplicar_fluxo_voz(bigint, bigint, text) to authenticated;

create or replace function public.criar_fluxo_de_modelo(empresa bigint, modelo text, credor bigint default null,
                                                        nome text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    m public.voz_fluxo_modelos;
    vid bigint;
begin
    select * into m from public.voz_fluxo_modelos where codigo = modelo;
    if m.codigo is null then
        raise exception 'modelo não encontrado';
    end if;
    vid := public.salvar_fluxo_voz(empresa, credor, coalesce(nullif(trim(criar_fluxo_de_modelo.nome), ''), m.nome),
                                   m.tipo_agente, m.definicao);
    update public.voz_fluxos f set modelo_origem = m.codigo
     where f.id = (select x.fluxo_id from public.voz_fluxo_versoes x where x.id = vid);
    return vid;
end $$;
revoke all on function public.criar_fluxo_de_modelo(bigint, text, bigint, text) from public, anon;
grant execute on function public.criar_fluxo_de_modelo(bigint, text, bigint, text) to authenticated;

-- base de respostas: edita no rascunho (editar_canais); revisa quem aprova o fluxo
create or replace function public.salvar_resposta_fluxo_voz(versao bigint, bloco text, pergunta text, resposta text,
                                                            resposta_id bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    v public.voz_fluxo_versoes;
    rid bigint;
begin
    select * into v from public.voz_fluxo_versoes where id = salvar_resposta_fluxo_voz.versao;
    if v.id is null or not public.pode_editar_fluxo_voz(v.empresa_id) then
        raise exception 'versão não encontrada ou sem permissão para editar o fluxo';
    end if;
    if v.situacao <> 'rascunho' then
        raise exception 'a base de respostas só muda no rascunho';
    end if;
    if not exists (select 1 from jsonb_array_elements(v.definicao -> 'blocos') b
                    where b ->> 'id' = bloco and b ->> 'tipo' = 'generativa') then
        raise exception 'o bloco % não é uma Conversa generativa desta versão', bloco;
    end if;
    if resposta_id is null then
        insert into public.voz_base_respostas (empresa_id, fluxo_versao_id, bloco_id, pergunta, resposta)
        values (v.empresa_id, versao, bloco, trim(salvar_resposta_fluxo_voz.pergunta), trim(salvar_resposta_fluxo_voz.resposta))
        returning id into rid;
    else
        update public.voz_base_respostas r set bloco_id = bloco, pergunta = trim(salvar_resposta_fluxo_voz.pergunta),
               resposta = trim(salvar_resposta_fluxo_voz.resposta), revisado_por = null, revisado_em = null
         where r.id = resposta_id and r.fluxo_versao_id = salvar_resposta_fluxo_voz.versao
        returning r.id into rid;
        if rid is null then
            raise exception 'resposta não encontrada';
        end if;
    end if;
    return rid;
end $$;
create or replace function public.revisar_resposta_fluxo_voz(resposta_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r public.voz_base_respostas;
begin
    select * into r from public.voz_base_respostas where id = resposta_id;
    if r.id is null or not public.pode_aprovar_fluxo_voz(r.empresa_id) then
        raise exception 'resposta não encontrada ou sem permissão para revisar';
    end if;
    update public.voz_base_respostas x set revisado_por = auth.uid(), revisado_em = now() where x.id = resposta_id;
end $$;
create or replace function public.apagar_resposta_fluxo_voz(resposta_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r public.voz_base_respostas;
begin
    select * into r from public.voz_base_respostas where id = resposta_id;
    if r.id is null or not public.pode_editar_fluxo_voz(r.empresa_id)
       or (select situacao from public.voz_fluxo_versoes where id = r.fluxo_versao_id) <> 'rascunho' then
        raise exception 'resposta não encontrada ou fora do rascunho';
    end if;
    delete from public.voz_base_respostas where id = resposta_id;
end $$;
revoke all on function public.salvar_resposta_fluxo_voz(bigint, text, text, text, bigint), public.revisar_resposta_fluxo_voz(bigint),
    public.apagar_resposta_fluxo_voz(bigint) from public, anon;
grant execute on function public.salvar_resposta_fluxo_voz(bigint, text, text, text, bigint), public.revisar_resposta_fluxo_voz(bigint),
    public.apagar_resposta_fluxo_voz(bigint) to authenticated;

-- casos de teste (editar_canais); o resultado é gravado pelo simulador (servidor)
create or replace function public.salvar_caso_teste_fluxo_voz(fluxo bigint, nome text, falas text[], caminho_esperado text[],
                                                              resultado_esperado text default null,
                                                              conectores_falham bigint[] default '{}',
                                                              caso bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    f public.voz_fluxos;
    cid bigint;
begin
    select * into f from public.voz_fluxos where id = fluxo;
    if f.id is null or not public.pode_editar_fluxo_voz(f.empresa_id) then
        raise exception 'fluxo não encontrado ou sem permissão para editar o fluxo';
    end if;
    if exists (select 1 from unnest(coalesce(conectores_falham, '{}')) k
                where not exists (select 1 from public.crm_conectores c where c.id = k and c.empresa_id = f.empresa_id)) then
        raise exception 'conector não encontrado';
    end if;
    if caso is null then
        insert into public.voz_fluxo_casos_teste (empresa_id, fluxo_id, nome, falas, caminho_esperado, resultado_esperado,
                                                  conectores_falham)
        values (f.empresa_id, fluxo, trim(salvar_caso_teste_fluxo_voz.nome), salvar_caso_teste_fluxo_voz.falas,
                salvar_caso_teste_fluxo_voz.caminho_esperado, salvar_caso_teste_fluxo_voz.resultado_esperado,
                coalesce(salvar_caso_teste_fluxo_voz.conectores_falham, '{}'))
        returning id into cid;
    else
        update public.voz_fluxo_casos_teste c set nome = trim(salvar_caso_teste_fluxo_voz.nome),
               falas = salvar_caso_teste_fluxo_voz.falas, caminho_esperado = salvar_caso_teste_fluxo_voz.caminho_esperado,
               resultado_esperado = salvar_caso_teste_fluxo_voz.resultado_esperado,
               conectores_falham = coalesce(salvar_caso_teste_fluxo_voz.conectores_falham, '{}'), atualizado_em = now()
         where c.id = caso and c.fluxo_id = fluxo
        returning c.id into cid;
        if cid is null then
            raise exception 'caso não encontrado';
        end if;
        delete from public.voz_fluxo_casos_resultados r where r.caso_id = cid;     -- o caso mudou: roda de novo
    end if;
    return cid;
end $$;
create or replace function public.apagar_caso_teste_fluxo_voz(caso bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c public.voz_fluxo_casos_teste;
begin
    select * into c from public.voz_fluxo_casos_teste where id = caso;
    if c.id is null or not public.pode_editar_fluxo_voz(c.empresa_id) then
        raise exception 'caso não encontrado';
    end if;
    delete from public.voz_fluxo_casos_teste where id = caso;
end $$;
create or replace function public.registrar_resultado_caso_voz(caso bigint, versao bigint, passou boolean,
                                                               caminho_obtido text[], resultado_obtido text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare c public.voz_fluxo_casos_teste;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o simulador (servidor) grava o resultado do caso';
    end if;
    select * into c from public.voz_fluxo_casos_teste where id = caso;
    if c.id is null or not exists (select 1 from public.voz_fluxo_versoes v where v.id = registrar_resultado_caso_voz.versao and v.fluxo_id = c.fluxo_id) then
        raise exception 'caso ou versão não encontrados';
    end if;
    insert into public.voz_fluxo_casos_resultados (caso_id, fluxo_versao_id, empresa_id, passou, caminho_obtido, resultado_obtido)
    values (caso, versao, c.empresa_id, passou, coalesce(caminho_obtido, '{}'), resultado_obtido)
    on conflict (caso_id, fluxo_versao_id) do update set passou = excluded.passou, caminho_obtido = excluded.caminho_obtido,
        resultado_obtido = excluded.resultado_obtido, executado_em = now();
end $$;
revoke all on function public.salvar_caso_teste_fluxo_voz(bigint, text, text[], text[], text, bigint[], bigint),
    public.apagar_caso_teste_fluxo_voz(bigint) from public, anon;
grant execute on function public.salvar_caso_teste_fluxo_voz(bigint, text, text[], text[], text, bigint[], bigint),
    public.apagar_caso_teste_fluxo_voz(bigint) to authenticated;
revoke all on function public.registrar_resultado_caso_voz(bigint, bigint, boolean, text[], text) from public, anon, authenticated;
grant execute on function public.registrar_resultado_caso_voz(bigint, bigint, boolean, text[], text) to service_role;

-- alçada da carteira (editar_credores). Mudar é criar vigência nova (a anterior fecha no dia de antes).
create or replace function public.salvar_alcada_voz(empresa bigint, credor bigint, desconto_max_pct numeric, parcelas_max int,
                                                    parcela_min numeric, entrada_min numeric default 0,
                                                    validade_dias int default 5, ofertas_padrao jsonb default '[]',
                                                    vigente_desde date default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    desde date := coalesce(vigente_desde, (now() at time zone 'America/Sao_Paulo')::date);
    atual public.voz_alcada_carteira;
    aid bigint;
begin
    if public.sou_equipe() or empresa not in (select public.minhas_empresas()) or not public.pode('editar_credores') then
        raise exception 'sem permissão para editar a alçada da carteira';
    end if;
    if credor is not null and not exists (select 1 from public.credores c where c.id = credor and c.empresa_id = empresa) then
        raise exception 'carteira não encontrada';
    end if;
    select * into atual from public.voz_alcada_carteira a
     where a.empresa_id = empresa and a.credor_id is not distinct from credor and a.vigente_ate is null for update;
    if atual.id is not null then
        if atual.vigente_desde >= desde then
            raise exception 'já há alçada vigente desde %: a nova vigência tem de começar depois', atual.vigente_desde;
        end if;
        update public.voz_alcada_carteira a set vigente_ate = desde - 1 where a.id = atual.id;
    end if;
    insert into public.voz_alcada_carteira (empresa_id, credor_id, desconto_max_pct, parcelas_max, parcela_min, entrada_min,
                                            validade_dias, ofertas_padrao, vigente_desde)
    values (empresa, credor, salvar_alcada_voz.desconto_max_pct, salvar_alcada_voz.parcelas_max, salvar_alcada_voz.parcela_min,
            coalesce(salvar_alcada_voz.entrada_min, 0), coalesce(salvar_alcada_voz.validade_dias, 5),
            coalesce(salvar_alcada_voz.ofertas_padrao, '[]'), desde)
    returning id into aid;
    return aid;
end $$;
revoke all on function public.salvar_alcada_voz(bigint, bigint, numeric, int, numeric, numeric, int, jsonb, date) from public, anon;
grant execute on function public.salvar_alcada_voz(bigint, bigint, numeric, int, numeric, numeric, int, jsonb, date) to authenticated;

-- ================================================================ 14. RPCs: conectores (equipe MotorCX, decisão 1)
create or replace function public.liberar_host_crm(empresa bigint, host text) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not public.cuida_conectores(empresa) then
        raise exception 'só a equipe MotorCX com a permissão de conectores libera hosts';
    end if;
    insert into public.crm_hosts_permitidos (empresa_id, host) values (empresa, lower(trim(liberar_host_crm.host)))
    on conflict on constraint crm_hosts_permitidos_pkey do nothing;
end $$;
create or replace function public.revogar_host_crm(empresa bigint, host text) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not public.cuida_conectores(empresa) then
        raise exception 'só a equipe MotorCX com a permissão de conectores revoga hosts';
    end if;
    if exists (select 1 from public.crm_conectores c
                where c.empresa_id = empresa and substring(c.url from '^https://([^/:?#]+)') = lower(trim(revogar_host_crm.host))) then
        raise exception 'há conector usando este host: mude a URL ou apague o conector antes';
    end if;
    delete from public.crm_hosts_permitidos h where h.empresa_id = empresa and h.host = lower(trim(revogar_host_crm.host));
end $$;
revoke all on function public.liberar_host_crm(bigint, text), public.revogar_host_crm(bigint, text) from public, anon;
grant execute on function public.liberar_host_crm(bigint, text), public.revogar_host_crm(bigint, text) to authenticated;

-- cria (conector nulo) ou edita. Mudança técnica (URL, método, autenticação, mapas, cabeçalhos, tempo, tentativas,
-- idempotência) sobe a versão e volta para rascunho: precisa de teste e de ativar de novo.
create or replace function public.salvar_conector_crm(empresa bigint, ajustes jsonb, conector bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    k text;
    c public.crm_conectores;
    cid bigint;
    tecnico boolean;
begin
    if not public.cuida_conectores(empresa) then
        raise exception 'só a equipe MotorCX com a permissão de conectores cadastra conectores';
    end if;
    if jsonb_typeof(ajustes) is distinct from 'object' then
        raise exception 'ajustes inválidos';
    end if;
    for k in select jsonb_object_keys(ajustes) loop
        if k not in ('nome', 'finalidade', 'metodo', 'url', 'autenticacao', 'cabecalhos_fixos', 'mapa_entrada', 'mapa_saida',
                     'timeout_ms', 'tentativas', 'idempotencia', 'em_falha') then
            raise exception 'ajuste desconhecido: % (a credencial muda só por trocar_credencial_conector)', k;
        end if;
    end loop;
    if conector is null then
        insert into public.crm_conectores (empresa_id, nome, finalidade, metodo, url, autenticacao, cabecalhos_fixos,
                                           mapa_entrada, mapa_saida, timeout_ms, tentativas, idempotencia, em_falha)
        values (empresa, trim(ajustes ->> 'nome'), ajustes ->> 'finalidade', ajustes ->> 'metodo', ajustes ->> 'url',
                ajustes ->> 'autenticacao', coalesce(ajustes -> 'cabecalhos_fixos', '{}'), coalesce(ajustes -> 'mapa_entrada', '[]'),
                coalesce(ajustes -> 'mapa_saida', '[]'), coalesce((ajustes ->> 'timeout_ms')::int, 2500),
                coalesce((ajustes ->> 'tentativas')::int, 0), coalesce((ajustes ->> 'idempotencia')::boolean, false),
                coalesce(ajustes ->> 'em_falha', 'ramo'))
        returning id into cid;
        return cid;
    end if;
    select * into c from public.crm_conectores x where x.id = conector and x.empresa_id = empresa for update;
    if c.id is null then
        raise exception 'conector não encontrado';
    end if;
    tecnico := exists (select 1 from jsonb_object_keys(ajustes) x
                        where x in ('metodo', 'url', 'autenticacao', 'cabecalhos_fixos', 'mapa_entrada', 'mapa_saida',
                                    'timeout_ms', 'tentativas', 'idempotencia', 'finalidade'));
    update public.crm_conectores x set
        nome = coalesce(trim(ajustes ->> 'nome'), x.nome),
        finalidade = coalesce(ajustes ->> 'finalidade', x.finalidade),
        metodo = coalesce(ajustes ->> 'metodo', x.metodo),
        url = coalesce(ajustes ->> 'url', x.url),
        autenticacao = coalesce(ajustes ->> 'autenticacao', x.autenticacao),
        cabecalhos_fixos = coalesce(ajustes -> 'cabecalhos_fixos', x.cabecalhos_fixos),
        mapa_entrada = coalesce(ajustes -> 'mapa_entrada', x.mapa_entrada),
        mapa_saida = coalesce(ajustes -> 'mapa_saida', x.mapa_saida),
        timeout_ms = coalesce((ajustes ->> 'timeout_ms')::int, x.timeout_ms),
        tentativas = coalesce((ajustes ->> 'tentativas')::int, x.tentativas),
        idempotencia = coalesce((ajustes ->> 'idempotencia')::boolean, x.idempotencia),
        em_falha = coalesce(ajustes ->> 'em_falha', x.em_falha),
        versao = x.versao + case when tecnico then 1 else 0 end,
        situacao = case when tecnico then 'rascunho' else x.situacao end,
        teste_ok = case when tecnico then null else x.teste_ok end,
        exemplo_resposta = case when tecnico then null else x.exemplo_resposta end,
        atualizado_em = now()
     where x.id = conector;
    return conector;
end $$;
revoke all on function public.salvar_conector_crm(bigint, jsonb, bigint) from public, anon;
grant execute on function public.salvar_conector_crm(bigint, jsonb, bigint) to authenticated;

-- novo nome de segredo no cofre (crm/<empresa>/<conector>/<versão da credencial>). A ferramenta da equipe grava o
-- valor direto no Secret Manager, por um envio só de escrita; o banco nunca vê a credencial. Pede novo teste.
create or replace function public.trocar_credencial_conector(conector bigint) returns text
language plpgsql security definer set search_path = public as $$
declare
    c public.crm_conectores;
    ref text;
begin
    select * into c from public.crm_conectores where id = conector for update;
    if c.id is null or not public.cuida_conectores(c.empresa_id) then
        raise exception 'só a equipe MotorCX com a permissão de conectores troca a credencial';
    end if;
    ref := format('crm/%s/%s/%s', c.empresa_id, c.id, to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSMS'));
    update public.crm_conectores x set segredo_ref = ref, credencial_trocada_em = now(), teste_ok = null,
           situacao = case when x.situacao = 'ativo' then 'pausado' else x.situacao end, atualizado_em = now()
     where x.id = conector;
    return ref;
end $$;
revoke all on function public.trocar_credencial_conector(bigint) from public, anon;
grant execute on function public.trocar_credencial_conector(bigint) to authenticated;

-- pede o teste à VM (cliente de teste). A resposta volta para a tela e não é gravada; só o exemplo com valores trocados.
create or replace function public.testar_conector_crm(conector bigint) returns text
language plpgsql security definer set search_path = public as $$
declare c public.crm_conectores;
begin
    select * into c from public.crm_conectores where id = conector;
    if c.id is null or not public.cuida_conectores(c.empresa_id) then
        raise exception 'só a equipe MotorCX com a permissão de conectores testa o conector';
    end if;
    if c.segredo_ref is null then
        raise exception 'grave a credencial no cofre antes de testar';
    end if;
    update public.crm_conectores x set teste_pedido_em = now(), testado_por = auth.uid() where x.id = conector;
    return 'pedido';
end $$;
create or replace function public.registrar_teste_conector_crm(conector bigint, ok boolean, exemplo jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not public.chamada_do_servidor() then
        raise exception 'só a VM registra o teste do conector';
    end if;
    update public.crm_conectores x set testado_em = now(), teste_ok = ok, teste_pedido_em = null,
           exemplo_resposta = case when ok then coalesce(exemplo, x.exemplo_resposta) else x.exemplo_resposta end
     where x.id = conector;
end $$;
create or replace function public.mudar_situacao_conector_crm(conector bigint, situacao text) returns text
language plpgsql security definer set search_path = public as $$
declare c public.crm_conectores;
begin
    select * into c from public.crm_conectores where id = conector for update;
    if c.id is null or not public.cuida_conectores(c.empresa_id) then
        raise exception 'só a equipe MotorCX com a permissão de conectores muda a situação';
    end if;
    if mudar_situacao_conector_crm.situacao not in ('ativo', 'pausado') then
        raise exception 'situação inválida';
    end if;
    if mudar_situacao_conector_crm.situacao = 'ativo' and not coalesce(c.teste_ok, false) then
        raise exception 'o conector só fica ativo depois de um teste bem-sucedido';
    end if;
    update public.crm_conectores x set situacao = mudar_situacao_conector_crm.situacao, atualizado_em = now() where x.id = conector;
    return mudar_situacao_conector_crm.situacao;
end $$;
revoke all on function public.testar_conector_crm(bigint), public.mudar_situacao_conector_crm(bigint, text) from public, anon;
grant execute on function public.testar_conector_crm(bigint), public.mudar_situacao_conector_crm(bigint, text) to authenticated;
revoke all on function public.registrar_teste_conector_crm(bigint, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_teste_conector_crm(bigint, boolean, jsonb) to service_role;

-- catálogo de intenções e modelos: só o Master da equipe
create or replace function public.salvar_intencao_voz(codigo text, nome text, descricao text default null,
                                                      ativa boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not public.admin_equipe() then
        raise exception 'só o Master da equipe MotorCX mantém o catálogo de intenções';
    end if;
    insert into public.voz_intencoes (codigo, nome, descricao, ativa)
    values (salvar_intencao_voz.codigo, trim(salvar_intencao_voz.nome), salvar_intencao_voz.descricao,
            coalesce(salvar_intencao_voz.ativa, true))
    on conflict on constraint voz_intencoes_pkey do update set nome = excluded.nome, descricao = excluded.descricao,
        ativa = excluded.ativa, atualizado_em = now();
end $$;
create or replace function public.salvar_modelo_fluxo_voz(codigo text, nome text, tipo_agente text, definicao jsonb,
                                                          descricao text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not public.admin_equipe() then
        raise exception 'só o Master da equipe MotorCX mantém os modelos de fluxo';
    end if;
    insert into public.voz_fluxo_modelos (codigo, nome, tipo_agente, descricao, definicao)
    values (salvar_modelo_fluxo_voz.codigo, trim(salvar_modelo_fluxo_voz.nome), salvar_modelo_fluxo_voz.tipo_agente,
            salvar_modelo_fluxo_voz.descricao, salvar_modelo_fluxo_voz.definicao)
    on conflict on constraint voz_fluxo_modelos_pkey do update set nome = excluded.nome, tipo_agente = excluded.tipo_agente,
        descricao = excluded.descricao, definicao = excluded.definicao, atualizado_em = now();
end $$;
revoke all on function public.salvar_intencao_voz(text, text, text, boolean),
    public.salvar_modelo_fluxo_voz(text, text, text, jsonb, text) from public, anon;
grant execute on function public.salvar_intencao_voz(text, text, text, boolean),
    public.salvar_modelo_fluxo_voz(text, text, text, jsonb, text) to authenticated;

-- ================================================================ 15. migração: roteiro em uso → fluxo v1 "Generativo único"
-- Abertura (primeira_fala) → Confirmar identidade (cognição, conferida pelo conector de validação do CRM, a escolher:
-- até lá, pendência identidade_sem_conferencia) → Conversa generativa com o
-- prompt atual → Transferir/Encerrar. regras_transferencia vira as saídas (devolve) do bloco generativo:
-- pedido_humano (sempre), contestacao, fora_alcada, ofertas_sem_acordo > 0 e cpc. Terceiro e "não confirmou" → recado.
create or replace function public.fluxo_do_roteiro_voz(r public.voz_roteiros) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
    rg jsonb := r.regras_transferencia;
    saidas jsonb := '[]';
    blocos jsonb;
    falar constant text := 'Vou passar você para um atendente agora, só um instante.';
    function_motivos text[][] := array[['contestacao', 'Contestou', 'N4'], ['fora_alcada', 'Fora da alçada', 'N5'],
                                       ['ofertas_sem_acordo', 'Ofertas sem acordo', 'N6'], ['cpc', 'Titular confirmado', 'N7']];
    i int;
    ligado boolean;
begin
    saidas := saidas || jsonb_build_object('rotulo', 'Pediu um atendente', 'para', 'N8', 'tipo', 'devolve', 'quando', 'pedido_humano');
    blocos := jsonb_build_array(
        jsonb_build_object('id', 'N1', 'tipo', 'abertura', 'modo', 'arvore', 'x', 300, 'y', 20,
            'params', jsonb_build_object('fala', r.primeira_fala),
            'saidas', jsonb_build_array(
                jsonb_build_object('rotulo', 'Sou eu', 'para', 'N2', 'tipo', 'normal', 'quando', 'titular'),
                jsonb_build_object('rotulo', 'Não é a pessoa', 'para', 'N9', 'tipo', 'normal', 'quando', 'terceiro'))),
        jsonb_build_object('id', 'N2', 'tipo', 'identidade', 'modo', 'cognicao', 'x', 300, 'y', 180,
            'params', jsonb_build_object('fala', 'Para sua segurança, me confirma o dia e o mês do seu nascimento?',
                                         'pergunta', 'dia_mes_nascimento', 'conector_id', null, 'tentativas', 2),
            'saidas', jsonb_build_array(
                jsonb_build_object('rotulo', 'Confirmou', 'para', 'N3', 'tipo', 'normal', 'quando', 'confirmou'),
                jsonb_build_object('rotulo', 'Não confirmou', 'para', 'N9', 'tipo', 'normal', 'quando', 'nao_confirmou'),
                jsonb_build_object('rotulo', 'Conector falhou', 'para', 'N8', 'tipo', 'falha', 'quando', 'falhou'))),
        jsonb_build_object('id', 'N8', 'tipo', 'transferir', 'modo', 'arvore', 'x', 560, 'y', 540,
            'params', jsonb_build_object('fala', falar, 'motivo', 'pedido_humano'), 'saidas', '[]'::jsonb),
        jsonb_build_object('id', 'N9', 'tipo', 'encerrar', 'modo', 'arvore', 'x', 560, 'y', 180, 'titulo', 'Encerrar · recado neutro',
            'params', jsonb_build_object('fala', 'Peço que {{primeiro_nome}} retorne a ligação para a {{assessoria}}. Obrigada.',
                                         'resultado', 'recado'), 'saidas', '[]'::jsonb));
    for i in 1 .. 4 loop
        ligado := case function_motivos[i][1]
                      when 'ofertas_sem_acordo' then (rg ->> 'ofertas_sem_acordo')::numeric > 0
                      else coalesce((rg ->> function_motivos[i][1])::boolean, false) end;
        if ligado then
            saidas := saidas || jsonb_build_object('rotulo', function_motivos[i][2], 'para', function_motivos[i][3],
                                                   'tipo', 'devolve', 'quando', function_motivos[i][1]);
            blocos := blocos || jsonb_build_object('id', function_motivos[i][3], 'tipo', 'transferir', 'modo', 'arvore',
                'x', 80 + 160 * i, 'y', 720,
                'params', jsonb_build_object('fala', falar, 'motivo', function_motivos[i][1]), 'saidas', '[]'::jsonb);
        end if;
    end loop;
    blocos := blocos || jsonb_build_object('id', 'N3', 'tipo', 'generativa', 'modo', 'generativo', 'x', 300, 'y', 360,
        'titulo', 'Generativo único (roteiro v' || r.versao || ')',
        'params', jsonb_build_object('objetivo', r.prompt, 'max_turnos', 40,
                                     'ferramentas', '["registrar_promessa", "agendar_retorno", "transferir_humano", "encerrar_chamada"]'::jsonb),
        'saidas', saidas);
    return jsonb_build_object('esquema', 1, 'blocos', blocos);
end $$;
revoke all on function public.fluxo_do_roteiro_voz(public.voz_roteiros) from public, anon, authenticated;

do $$
declare
    r public.voz_roteiros;
    d jsonb;
    erros text[];
    fid bigint;
begin
    for r in select * from public.voz_roteiros x where x.situacao = 'em_uso'
              and not exists (select 1 from public.voz_fluxos f where f.roteiro_origem_id = x.id) order by x.id loop
        d := public.fluxo_do_roteiro_voz(r);
        erros := public.fluxo_voz_erros(d);
        insert into public.voz_fluxos (empresa_id, credor_id, nome, tipo_agente, modelo_origem, roteiro_origem_id, criado_por, criado_em)
        values (r.empresa_id, r.credor_id,
                'Roteiro v' || r.versao || case when exists (select 1 from public.voz_fluxos f where f.empresa_id = r.empresa_id
                                                              and f.credor_id is not distinct from r.credor_id
                                                              and f.nome = 'Roteiro v' || r.versao)
                                                then ' (' || r.id || ')' else '' end,
                r.tipo_agente, 'roteiro', r.id, r.criado_por, r.criado_em)
        returning id into fid;
        -- Sempre rascunho: a identidade agora é conferida pelo conector de validação do CRM (nunca pela IA), que a
        -- empresa ainda não tem; até escolher o conector e aprovar, a carteira segue com o roteiro em uso (o executor
        -- cai no roteiro quando não há fluxo em uso). Texto que não cabe no esquema (ex.: valor na primeira fala) vai
        -- no motivo.
        insert into public.voz_fluxo_versoes (fluxo_id, empresa_id, versao, situacao, definicao, motivo, parecer, criado_por, criado_em)
        values (fid, r.empresa_id, 1, 'rascunho', d,
                left(case when cardinality(erros) = 0
                          then 'migrado do roteiro v' || r.versao || ': escolha o conector de validação e aprove'
                          else 'migração: revisar antes de aprovar (' || array_to_string(erros, ', ') || ')' end, 300),
                r.parecer, r.criado_por, r.criado_em);
    end loop;
end $$;

-- ================================================================ 15b. pedidos de fluxo em texto (pedido do dono, depois do protótipo)
-- O cliente descreve em texto como quer o fluxo (ou a mudança num fluxo que já existe) e o MotorCX cria o rascunho:
--   tipo 'ia'     → a geração (gerar_fluxo_voz, na VM) pede a definição a um LLM no esquema fechado, valida com o mesmo
--                   validador (até 2 correções) e só vira rascunho se passar em fluxo_voz_valido. A chave do LLM fica no
--                   Secret Manager (segredo voz/llm-fluxo); o banco nunca vê a chave.
--   tipo 'equipe' → abre um chamado no Suporte e a equipe monta o rascunho.
-- O resultado ("o que entendi" frase → bloco, "suposições e perguntas", o que mudou em relação à versão de origem e os
-- erros que sobraram) fica em `resultado`; as respostas da empresa às perguntas vão em `respostas` e pedem nova geração.
-- Anexos: referências ao Storage da própria empresa ('entradas/<slug>/...' ou 'chamados/<slug>/...'), nunca o arquivo.
-- Decisões do dono:
--   * geração pela IA SEM LIMITE de pedidos, com o custo visível no extrato: cada geração feita conta 1 no item
--     ia_geracao_fluxo (consumo_mensageria → fatura, com o preço da empresa); falha do LLM antes de gerar não conta;
--   * pedido à equipe: prazo de 2 dias úteis (seg a sex; feriados não contam como exceção, como nos chamados),
--     gravado em prazo_em e escrito no chamado; a equipe entrega com entregar_pedido_fluxo_equipe;
--   * anexos guardados ENQUANTO A VERSÃO GERADA EXISTIR. Sem versão gerada (com_erros ou cancelado), 30 dias sem
--     movimento. anexos_fluxo_vencidos() lista o que pode sair e a VM apaga do Storage (voz/gerar_fluxo.py) e
--     marca com marcar_anexos_apagados().
insert into public.cobranca_itens (codigo, produto, nome, unidade, preco_de, modulo, ordem, descricao) values
    ('ia_geracao_fluxo', 'agente_voz', 'Agente virtual · geração de fluxo por IA', 'geração', null, 'agente_voz', 55,
     'cada fluxo gerado por IA a partir do texto da empresa (sem limite)')
on conflict (codigo) do nothing;

-- soma n dias úteis (seg a sex, em São Paulo) a um instante
create or replace function public.somar_dias_uteis(inicio timestamptz, n int) returns timestamptz
language plpgsql immutable parallel safe as $$
declare
    t timestamp := inicio at time zone 'America/Sao_Paulo';
    k int := 0;
begin
    while k < n loop
        t := t + interval '1 day';
        if extract(isodow from t) < 6 then
            k := k + 1;
        end if;
    end loop;
    return t at time zone 'America/Sao_Paulo';
end $$;
create or replace function public.anexos_pedido_voz_ok(a text[]) returns boolean
language sql immutable parallel safe as $$
    select coalesce(cardinality(a) <= 10
                    and not exists (select 1 from unnest(a) x
                                     where x is null or char_length(x) > 300 or x !~ '^(entradas|chamados)/[a-z0-9][a-z0-9_\-]*/[A-Za-z0-9_\-/. ]+$'
                                        or x ~ '\.\.' or x ~ '[0-9]{10,}'), false)
$$;
-- resultado da geração: só estas chaves, listas curtas de texto
create or replace function public.resultado_pedido_voz_ok(r jsonb) returns boolean
language sql immutable parallel safe as $$
    select r is null or coalesce(jsonb_typeof(r) = 'object' and octet_length(r::text) <= 100000
           and not exists (select 1 from jsonb_object_keys(r) k
                            where k not in ('entendi', 'suposicoes', 'perguntas', 'mudancas', 'erros', 'tentativas'))
           and not exists (select 1 from jsonb_each(r) e where e.key <> 'tentativas' and jsonb_typeof(e.value) <> 'array')
           and (not r ? 'tentativas' or public.fluxo_voz_aux_inteiro(r -> 'tentativas', 0, 3)), false)
$$;

create table if not exists public.voz_fluxo_pedidos (
    id                bigint generated always as identity primary key,
    empresa_id        bigint not null references public.empresas (id) on delete cascade,
    credor_id         bigint references public.credores (id) on delete cascade,     -- nulo = empresa toda
    texto             text not null check (char_length(trim(texto)) between 10 and 8000),
    anexos            text[] not null default '{}' check (public.anexos_pedido_voz_ok(anexos)),
    tipo              text not null check (tipo in ('ia', 'equipe')),
    fluxo_id          bigint references public.voz_fluxos (id) on delete set null,          -- nulo = fluxo novo
    versao_origem_id  bigint references public.voz_fluxo_versoes (id) on delete set null,
    versao_gerada_id  bigint references public.voz_fluxo_versoes (id) on delete set null,
    situacao          text not null default 'pendente'
                      check (situacao in ('pendente', 'gerando', 'gerado', 'com_erros', 'na_equipe', 'cancelado')),
    chamado_id        bigint references public.chamados (id) on delete set null,
    respostas         jsonb check (respostas is null or (jsonb_typeof(respostas) = 'object' and octet_length(respostas::text) <= 20000)),
    resultado         jsonb check (public.resultado_pedido_voz_ok(resultado)),
    pedido_por        uuid default auth.uid() references auth.users (id) on delete set null,
    pedido_em         timestamptz not null default now(),
    atualizado_em     timestamptz not null default now(),
    gerado_em         timestamptz,
    geracoes          int not null default 0 check (geracoes >= 0),            -- quantas vezes a IA gerou (extrato)
    prazo_em          timestamptz,                                              -- equipe: 2 dias úteis
    anexos_apagados_em timestamptz,
    check (versao_origem_id is null or fluxo_id is not null),
    check (tipo = 'ia' or prazo_em is not null),
    check (tipo = 'ia' or situacao in ('na_equipe', 'gerado', 'cancelado'))
    -- 'gerado' com versao_gerada_id nulo = a versão gerada deixou de existir (os anexos podem sair)
);
create index if not exists voz_fluxo_pedidos_fila on public.voz_fluxo_pedidos (pedido_em) where situacao = 'pendente';
create index if not exists voz_fluxo_pedidos_empresa on public.voz_fluxo_pedidos (empresa_id, pedido_em desc);
comment on table public.voz_fluxo_pedidos is
    'Pedido de fluxo em texto (novo ou mudança). Só vira rascunho o que passa no validador; nunca aprova nem coloca em uso.';
alter table public.voz_fluxo_pedidos enable row level security;
drop policy if exists voz_fluxo_pedidos_ver on public.voz_fluxo_pedidos;
create policy voz_fluxo_pedidos_ver on public.voz_fluxo_pedidos for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_fluxo_pedidos from anon;
revoke insert, update, delete on public.voz_fluxo_pedidos from authenticated;

-- confere carteira, origem e anexos (comum aos dois pedidos)
create or replace function public.conferir_pedido_fluxo_voz(empresa bigint, credor bigint, anexos text[], versao_origem bigint)
returns bigint
language plpgsql stable security definer set search_path = public as $$
declare
    v public.voz_fluxo_versoes;
    slug text;
begin
    if not public.pode_editar_fluxo_voz(empresa) then
        raise exception 'sem permissão para editar o fluxo do agente virtual';
    end if;
    if credor is not null and not exists (select 1 from public.credores c where c.id = credor and c.empresa_id = empresa) then
        raise exception 'carteira não encontrada';
    end if;
    select e.slug into slug from public.empresas e where e.id = empresa;
    if exists (select 1 from unnest(coalesce(anexos, '{}')) x where split_part(x, '/', 2) <> slug) then
        raise exception 'anexo fora do Storage da empresa';
    end if;
    if versao_origem is null then
        return null;
    end if;
    select * into v from public.voz_fluxo_versoes x where x.id = versao_origem and x.empresa_id = empresa;
    if v.id is null or v.credor_id is distinct from credor then
        raise exception 'versão de origem não encontrada nesta carteira';
    end if;
    return v.fluxo_id;
end $$;
revoke all on function public.conferir_pedido_fluxo_voz(bigint, bigint, text[], bigint) from public, anon, authenticated;

-- pedido para a geração automática (tipo ia)
create or replace function public.pedir_fluxo_voz(empresa bigint, credor bigint, texto text, anexos text[] default '{}',
                                                  versao_origem bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    fid bigint;
    pid bigint;
begin
    fid := public.conferir_pedido_fluxo_voz(empresa, credor, anexos, versao_origem);
    if exists (select 1 from public.voz_fluxo_pedidos p where p.empresa_id = empresa and p.credor_id is not distinct from credor
                                                            and p.situacao in ('pendente', 'gerando')) then
        raise exception 'já há um pedido desta carteira sendo gerado';
    end if;
    insert into public.voz_fluxo_pedidos (empresa_id, credor_id, texto, anexos, tipo, fluxo_id, versao_origem_id)
    values (empresa, credor, trim(pedir_fluxo_voz.texto), coalesce(pedir_fluxo_voz.anexos, '{}'), 'ia', fid, versao_origem)
    returning id into pid;
    return pid;
end $$;

-- pedido para a equipe MotorCX: abre chamado no Suporte com o texto e os anexos
create or replace function public.pedir_fluxo_equipe(empresa bigint, credor bigint, texto text, anexos text[] default '{}',
                                                     versao_origem bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    fid bigint;
    pid bigint;
    ch bigint;
    prazo timestamptz;
begin
    fid := public.conferir_pedido_fluxo_voz(empresa, credor, anexos, versao_origem);
    insert into public.chamados (empresa_id, motivo, assunto, prioridade)
    values (empresa, 'integracao', case when versao_origem is null then 'Fluxo do agente virtual: criar fluxo novo'
                                        else 'Fluxo do agente virtual: mudar um fluxo' end, 'normal')
    returning id into ch;
    prazo := public.somar_dias_uteis(now(), 2);
    insert into public.chamado_mensagens (chamado_id, empresa_id, tipo, texto, anexos)
    values (ch, empresa, 'cliente', trim(pedir_fluxo_equipe.texto) || chr(10) || chr(10) || 'Prazo da equipe MotorCX: até '
                || to_char(prazo at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ' (2 dias úteis).',
            coalesce((select jsonb_agg(x) from unnest(coalesce(pedir_fluxo_equipe.anexos, '{}')) with ordinality u(x, n) where n <= 5), '[]'));
    insert into public.voz_fluxo_pedidos (empresa_id, credor_id, texto, anexos, tipo, fluxo_id, versao_origem_id, situacao,
                                          chamado_id, prazo_em)
    values (empresa, credor, trim(pedir_fluxo_equipe.texto), coalesce(pedir_fluxo_equipe.anexos, '{}'), 'equipe', fid,
            versao_origem, 'na_equipe', ch, prazo)
    returning id into pid;
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
    select 'equipe', empresa, 'atencao', left('Pedido de fluxo do agente · ' || e.nome, 140),
           'Montar o rascunho do fluxo pedido pela empresa até ' || to_char(prazo at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
           || ' (2 dias úteis).', '/console/chamados', 'voz_fluxo_pedido:' || pid
      from public.empresas e where e.id = empresa;
    return pid;
end $$;

-- respostas às perguntas da geração: o pedido volta para a fila
create or replace function public.responder_pedido_fluxo_voz(pedido bigint, respostas jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare p public.voz_fluxo_pedidos;
begin
    select * into p from public.voz_fluxo_pedidos x where x.id = pedido;
    if p.id is null or not public.pode_editar_fluxo_voz(p.empresa_id) then
        raise exception 'pedido não encontrado';
    end if;
    if p.tipo <> 'ia' or p.situacao not in ('gerado', 'com_erros') then
        raise exception 'só um pedido já gerado recebe respostas';
    end if;
    update public.voz_fluxo_pedidos x set respostas = responder_pedido_fluxo_voz.respostas, situacao = 'pendente',
           atualizado_em = now()
     where x.id = pedido;
end $$;
revoke all on function public.pedir_fluxo_voz(bigint, bigint, text, text[], bigint),
    public.pedir_fluxo_equipe(bigint, bigint, text, text[], bigint), public.responder_pedido_fluxo_voz(bigint, jsonb) from public, anon;
grant execute on function public.pedir_fluxo_voz(bigint, bigint, text, text[], bigint),
    public.pedir_fluxo_equipe(bigint, bigint, text, text[], bigint), public.responder_pedido_fluxo_voz(bigint, jsonb) to authenticated;

-- a geração (VM) pega o próximo pedido e recebe o contexto da empresa: conectores ativos (só id, nome, finalidade e os
-- campos que preenchem), intenções do catálogo, variáveis, alçada e a definição de origem. Nada do CRM nem do devedor.
create or replace function public.pegar_pedido_fluxo_voz() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.voz_fluxo_pedidos;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só a geração (servidor) pega pedidos';
    end if;
    select * into p from public.voz_fluxo_pedidos x where x.situacao = 'pendente' and x.tipo = 'ia'
     order by x.pedido_em limit 1 for update skip locked;
    if p.id is null then
        return null;
    end if;
    update public.voz_fluxo_pedidos x set situacao = 'gerando', atualizado_em = now() where x.id = p.id;
    return jsonb_build_object(
        'pedido', p.id, 'empresa_id', p.empresa_id, 'credor_id', p.credor_id, 'texto', p.texto, 'respostas', p.respostas,
        'anexos', to_jsonb(p.anexos),
        'origem', (select v.definicao from public.voz_fluxo_versoes v where v.id = p.versao_origem_id),
        'conectores', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'finalidade', c.finalidade,
                                    'campos', (select coalesce(jsonb_agg(m ->> 'destino'), '[]') from jsonb_array_elements(c.mapa_saida) m))
                                    order by c.id)
                                  from public.crm_conectores c where c.empresa_id = p.empresa_id and c.situacao = 'ativo'), '[]'),
        'intencoes', coalesce((select jsonb_agg(i.codigo order by i.codigo) from public.voz_intencoes i where i.ativa), '[]'),
        'variaveis', to_jsonb(public.variaveis_voz() || public.campos_oferta_voz()),
        'tem_alcada', exists (select 1 from public.voz_alcada_carteira a
                               where a.empresa_id = p.empresa_id and (a.credor_id = p.credor_id or a.credor_id is null)
                                 and a.vigente_ate is null));
end $$;

-- a geração devolve o resultado. Definição inválida (ou com pendência de contexto que a geração inventou: conector
-- que a empresa não tem, intenção fora do catálogo) nunca vira rascunho: o pedido fica com_erros e os erros vão no resultado.
create or replace function public.registrar_geracao_fluxo_voz(pedido bigint, definicao jsonb, resultado jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    p public.voz_fluxo_pedidos;
    erros text[];
    vid bigint;
    fid bigint;
    nome text;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só a geração (servidor) registra o resultado';
    end if;
    select * into p from public.voz_fluxo_pedidos x where x.id = pedido for update;
    if p.id is null or p.situacao <> 'gerando' then
        raise exception 'pedido não está em geração';
    end if;
    -- extrato: toda geração feita conta (válida ou não); LLM fora antes de gerar não conta
    if definicao is not null or not coalesce(resultado -> 'erros' <@ '["llm_indisponivel", "falha_na_geracao"]'::jsonb
                                             and jsonb_array_length(resultado -> 'erros') > 0, false) then
        insert into public.consumo_mensageria (empresa_id, competencia, item, quantidade)
        values (p.empresa_id, date_trunc('month', now() at time zone 'America/Sao_Paulo')::date, 'ia_geracao_fluxo', 1)
        on conflict (empresa_id, competencia, item) do update
            set quantidade = public.consumo_mensageria.quantidade + 1, atualizado_em = now();
        update public.voz_fluxo_pedidos x set geracoes = x.geracoes + 1 where x.id = pedido;
    end if;
    erros := case when definicao is null
                  then coalesce(nullif(array(select jsonb_array_elements_text(
                           case when jsonb_typeof(resultado -> 'erros') = 'array' then resultado -> 'erros' else '[]' end)), '{}'),
                       array['sem_definicao'])
                  else public.fluxo_voz_erros(definicao) end;
    if cardinality(erros) = 0 then
        -- conector ainda não escolhido (null) é aceito: a empresa escolhe antes de aprovar. Conector com id que não é
        -- um conector ativo da empresa = inventado → recusa.
        erros := array(select e from unnest(public.fluxo_voz_pendencias(p.empresa_id, p.credor_id, definicao)) e
                        where split_part(e, ':', 1) in ('conector_finalidade', 'intencao_fora_catalogo')
                           or (split_part(e, ':', 1) = 'conector_inativo' and exists (
                                select 1 from jsonb_array_elements(definicao -> 'blocos') b,
                                       lateral (select b -> 'params' -> 'conector_id' as c
                                                union all
                                                select x from jsonb_array_elements(case when jsonb_typeof(b -> 'params' -> 'conectores') = 'array'
                                                                                        then b -> 'params' -> 'conectores' else '[]' end) x) ids
                                 where b ->> 'id' = split_part(e, ':', 2) and jsonb_typeof(ids.c) = 'number'
                                   and not exists (select 1 from public.crm_conectores k
                                                    where k.id = (ids.c #>> '{}')::bigint and k.empresa_id = p.empresa_id
                                                      and k.situacao = 'ativo'))));
    end if;
    if cardinality(erros) > 0 then
        update public.voz_fluxo_pedidos x set situacao = 'com_erros', atualizado_em = now(), gerado_em = now(),
               resultado = coalesce(registrar_geracao_fluxo_voz.resultado, '{}'::jsonb) || jsonb_build_object('erros', to_jsonb(erros))
         where x.id = pedido;
        return null;
    end if;
    if p.fluxo_id is null then
        nome := 'Pedido ' || p.id;
        insert into public.voz_fluxos (empresa_id, credor_id, nome, tipo_agente, modelo_origem, criado_por)
        values (p.empresa_id, p.credor_id, nome, 'negociador', 'pedido_texto', p.pedido_por) returning id into fid;
        insert into public.voz_fluxo_versoes (fluxo_id, empresa_id, versao, definicao, motivo, criado_por)
        values (fid, p.empresa_id, 1, definicao, 'gerado do pedido em texto ' || p.id, p.pedido_por) returning id into vid;
    else
        -- mudança: novo rascunho do fluxo (troca o rascunho aberto, se houver)
        select x.id into vid from public.voz_fluxo_versoes x where x.fluxo_id = p.fluxo_id and x.situacao = 'rascunho';
        if vid is not null then
            update public.voz_fluxo_versoes x set definicao = registrar_geracao_fluxo_voz.definicao, atualizado_em = now(),
                   motivo = 'gerado do pedido em texto ' || p.id where x.id = vid;
        else
            insert into public.voz_fluxo_versoes (fluxo_id, empresa_id, versao, definicao, motivo, criado_por)
            values (p.fluxo_id, p.empresa_id, (select max(x.versao) + 1 from public.voz_fluxo_versoes x where x.fluxo_id = p.fluxo_id),
                    definicao, 'gerado do pedido em texto ' || p.id, p.pedido_por)
            returning id into vid;
        end if;
    end if;
    update public.voz_fluxo_pedidos x set situacao = 'gerado', versao_gerada_id = vid, resultado = registrar_geracao_fluxo_voz.resultado,
           gerado_em = now(), atualizado_em = now()
     where x.id = pedido;
    return vid;
end $$;
-- a equipe entrega o rascunho do pedido feito a ela (valida igual; nunca aprova nem coloca em uso)
create or replace function public.entregar_pedido_fluxo_equipe(pedido bigint, definicao jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    p public.voz_fluxo_pedidos;
    vid bigint;
    fid bigint;
begin
    select * into p from public.voz_fluxo_pedidos x where x.id = pedido for update;
    if p.id is null or not public.equipe_pode('responder_chamados', p.empresa_id) then
        raise exception 'pedido não encontrado ou sem permissão (responder chamados)';
    end if;
    if p.tipo <> 'equipe' or p.situacao <> 'na_equipe' then
        raise exception 'o pedido não está com a equipe';
    end if;
    if not public.fluxo_voz_valido(definicao) then
        raise exception 'fluxo inválido: %', array_to_string(public.fluxo_voz_erros(definicao), ', ');
    end if;
    if p.fluxo_id is null then
        insert into public.voz_fluxos (empresa_id, credor_id, nome, tipo_agente, modelo_origem, criado_por)
        values (p.empresa_id, p.credor_id, 'Pedido ' || p.id, 'negociador', 'pedido_equipe', p.pedido_por) returning id into fid;
        insert into public.voz_fluxo_versoes (fluxo_id, empresa_id, versao, definicao, motivo, criado_por)
        values (fid, p.empresa_id, 1, definicao, 'montado pela equipe (pedido ' || p.id || ')', auth.uid()) returning id into vid;
    else
        select x.id into vid from public.voz_fluxo_versoes x where x.fluxo_id = p.fluxo_id and x.situacao = 'rascunho';
        if vid is not null then
            update public.voz_fluxo_versoes x set definicao = entregar_pedido_fluxo_equipe.definicao, atualizado_em = now(),
                   motivo = 'montado pela equipe (pedido ' || p.id || ')' where x.id = vid;
        else
            insert into public.voz_fluxo_versoes (fluxo_id, empresa_id, versao, definicao, motivo, criado_por)
            values (p.fluxo_id, p.empresa_id, (select max(x.versao) + 1 from public.voz_fluxo_versoes x where x.fluxo_id = p.fluxo_id),
                    definicao, 'montado pela equipe (pedido ' || p.id || ')', auth.uid())
            returning id into vid;
        end if;
    end if;
    update public.voz_fluxo_pedidos x set situacao = 'gerado', versao_gerada_id = vid, gerado_em = now(), atualizado_em = now()
     where x.id = pedido;
    return vid;
end $$;
revoke all on function public.entregar_pedido_fluxo_equipe(bigint, jsonb) from public, anon;
grant execute on function public.entregar_pedido_fluxo_equipe(bigint, jsonb) to authenticated;

-- anexos que já podem sair do Storage: a versão gerada deixou de existir, ou o pedido terminou sem versão e está há
-- 30 dias sem movimento. A VM apaga os objetos e marca com marcar_anexos_apagados.
create or replace function public.anexos_fluxo_vencidos() returns table (pedido_id bigint, anexos text[])
language sql stable security definer set search_path = public as $$
    select p.id, p.anexos from public.voz_fluxo_pedidos p
     where (public.chamada_do_servidor() or public.chamada_da_vm_voz()) and cardinality(p.anexos) > 0
       and ((p.situacao = 'gerado' and p.versao_gerada_id is null)
            or (p.situacao in ('com_erros', 'cancelado') and p.versao_gerada_id is null
                and p.atualizado_em < now() - interval '30 days'))
$$;
create or replace function public.marcar_anexos_apagados(pedido bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor apaga anexos';
    end if;
    update public.voz_fluxo_pedidos x set anexos = '{}', anexos_apagados_em = now() where x.id = pedido;
end $$;
revoke all on function public.anexos_fluxo_vencidos(), public.marcar_anexos_apagados(bigint) from public, anon, authenticated;
grant execute on function public.anexos_fluxo_vencidos(), public.marcar_anexos_apagados(bigint) to service_role;

revoke all on function public.pegar_pedido_fluxo_voz(), public.registrar_geracao_fluxo_voz(bigint, jsonb, jsonb)
    from public, anon, authenticated;
grant execute on function public.pegar_pedido_fluxo_voz(), public.registrar_geracao_fluxo_voz(bigint, jsonb, jsonb) to service_role;

-- ================================================================ 16. auditoria e permissões das funções
do $$
declare t text;
begin
    foreach t in array array['voz_fluxos', 'voz_fluxo_versoes', 'voz_fluxo_modelos', 'voz_intencoes', 'crm_hosts_permitidos',
                             'crm_conectores', 'voz_alcada_carteira', 'voz_base_respostas', 'voz_fluxo_casos_teste',
                             'voz_fluxo_pedidos'] loop
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
                and (p.proname like 'fluxo\_voz\_%' or p.proname in ('variaveis_voz', 'campos_oferta_voz', 'codigos_conector_voz',
                     'origens_entrada_conector', 'destinos_saida_conector', 'nome_pessoal_conector', 'mapa_conector_valido',
                     'cabecalhos_conector_validos', 'exemplo_resposta_seguro', 'ofertas_alcada_validas', 'falas_teste_voz_ok', 'contagem_codigos_ok',
                     'anexos_pedido_voz_ok', 'resultado_pedido_voz_ok', 'somar_dias_uteis'))
                and p.proname not in ('fluxo_voz_pendencias', 'fluxo_voz_bloqueios', 'fluxo_voz_em_uso') loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated, service_role', f);
    end loop;
end $$;

-- ================================================================ 17. acesso próprio da VM (schema voz_vm do SQL 57)
-- O que o executor do fluxo (voz/fluxo.py, voz/registro.py) e a geração por IA (voz/gerar_fluxo.py) usam, para a VM
-- funcionar igual com a chave do servidor e com o papel motorcx_voz (voz/acesso.py › LEITURA, ESCRITA e RPC).
-- Mesmo padrão do SQL 57: leitura por views de colunas escolhidas (do dono das tabelas: sem RLS no caminho, por isso
-- o filtro de empresa com voz fica na própria view, sem chamar função que o papel não executa), escrita e RPC só por funções security definer com search_path
-- vazio, nomes qualificados e validação por linha. Nada aqui dá ao papel acesso a tabela do public.

-- leitura: conectores ATIVOS das empresas com voz, só as colunas que o executor usa. segredo_ref é o nome do segredo
-- no Secret Manager (a credencial nunca está no banco); exemplo_resposta e quem testou ficam de fora (são do simulador).
create or replace view voz_vm.crm_conectores with (security_barrier = true) as
    select c.id, c.empresa_id, c.nome, c.finalidade, c.metodo, c.url, c.autenticacao, c.segredo_ref, c.cabecalhos_fixos,
           c.mapa_entrada, c.mapa_saida, c.timeout_ms, c.tentativas, c.idempotencia, c.em_falha, c.situacao, c.versao
      from public.crm_conectores c
     where c.situacao = 'ativo' and exists (select 1 from public.voz_config v where v.empresa_id = c.empresa_id);

-- leitura: hosts liberados (o host da URL do conector tem de continuar liberado na hora da chamada)
create or replace view voz_vm.crm_hosts_permitidos with (security_barrier = true) as
    select h.empresa_id, h.host from public.crm_hosts_permitidos h
     where exists (select 1 from public.voz_config v where v.empresa_id = h.empresa_id);

-- leitura: base de respostas do Generativo, só as revisadas (as outras nunca vão à ligação)
create or replace view voz_vm.base_respostas with (security_barrier = true) as
    select r.id, r.empresa_id, r.fluxo_versao_id, r.bloco_id, r.pergunta, r.resposta, r.revisado_em
      from public.voz_base_respostas r
     where r.revisado_em is not null and exists (select 1 from public.voz_config v where v.empresa_id = r.empresa_id);

revoke all on voz_vm.crm_conectores, voz_vm.crm_hosts_permitidos, voz_vm.base_respostas
    from public, anon, authenticated, service_role;
grant select on voz_vm.crm_conectores, voz_vm.crm_hosts_permitidos, voz_vm.base_respostas to motorcx_voz;

-- RPC da VM: cada uma recebe os mesmos argumentos da RPC do public (um objeto jsonb, como o corpo do PostgREST) e
-- devolve o que o PostgREST devolveria (lista para "returns table", objeto para uma linha, valor ou null).
-- versão em uso do fluxo da carteira (public.fluxo_voz_em_uso aceita a VM: chamada_da_vm_voz)
create or replace function voz_vm.fluxo_em_uso(args jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
    select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
      from public.fluxo_voz_em_uso((args ->> 'empresa')::bigint, (args ->> 'credor')::bigint) f
     where voz_vm.tem_voz((args ->> 'empresa')::bigint)
$$;

-- alçada vigente da carteira (ou da empresa toda); sem alçada: o objeto com tudo nulo, como o PostgREST
create or replace function voz_vm.alcada_vigente(args jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
    select to_jsonb(a)
      from public.alcada_voz_vigente((args ->> 'empresa')::bigint, (args ->> 'credor')::bigint, (args ->> 'dia')::date) a
     where voz_vm.tem_voz((args ->> 'empresa')::bigint)
$$;

-- geração por IA (voz/gerar_fluxo.py): as funções do public aceitam a VM (chamada_da_vm_voz) e validam tudo
create or replace function voz_vm.pegar_pedido_fluxo(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select public.pegar_pedido_fluxo_voz()
$$;
create or replace function voz_vm.registrar_geracao_fluxo(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select to_jsonb(public.registrar_geracao_fluxo_voz((args ->> 'pedido')::bigint,
                                                      case when jsonb_typeof(args -> 'definicao') = 'object'
                                                           then args -> 'definicao' end,
                                                      args -> 'resultado'))
$$;
create or replace function voz_vm.anexos_fluxo_vencidos(args jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
    select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.anexos_fluxo_vencidos() a
$$;
create or replace function voz_vm.marcar_anexos_apagados(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    perform public.marcar_anexos_apagados((args ->> 'pedido')::bigint);
    return null;
end $$;

-- arquivos: a VM apaga do Storage só o anexo que o banco já liberou (anexos_fluxo_vencidos), pelo bilhete do SQL 57.
-- O anexo é 'entradas/<slug>/...' ou 'chamados/<slug>/...' (anexos_pedido_voz_ok); o bilhete guarda bucket e caminho.
-- Rodar de novo não estreita a lista: mantém os buckets que SQL seguintes acrescentaram (o 64 põe gravacoes-discador)
do $$
declare
    def text;
    lista text;
begin
    select pg_get_constraintdef(c.oid) into def from pg_constraint c
     where c.conrelid = 'voz_vm.bilhetes'::regclass and c.conname = 'bilhetes_bucket_check';
    if def is null or position('chamados' in def) = 0 then
        select string_agg(quote_literal(b), ', ' order by b) into lista
          from (select distinct m[1] as b from regexp_matches(coalesce(def, ''), '''([a-z0-9-]+)''', 'g') as m
                union select unnest(array['saidas', 'entradas', 'chamados'])) z;
        alter table voz_vm.bilhetes drop constraint if exists bilhetes_bucket_check;
        execute format('alter table voz_vm.bilhetes add constraint bilhetes_bucket_check check (bucket in (%s))', lista);
    end if;
end $$;
select pg_temp.trocar('voz_vm.empresa_do_caminho(text, text, text)',
    '    if operacao = ''baixar'' and bucket = ''saidas'' then',
    '    if operacao = ''apagar'' and bucket in (''entradas'', ''chamados'') then       -- SQL 58: anexo de pedido de fluxo
        select p.empresa_id into e from public.voz_fluxo_pedidos p
         where p.id in (select a.pedido_id from public.anexos_fluxo_vencidos() a
                         where (bucket || ''/'' || caminho) = any (a.anexos))
         limit 1;
        if e is not null then
            return e;
        end if;
    end if;
    if operacao = ''baixar'' and bucket = ''saidas'' then');

-- escrita: chamadas. A mesma função do SQL 57 com fluxo_versao_id (versão da mesma empresa) e bloco_final.
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
                           'transcricao', 'fluxo_versao_id', 'bloco_final']);
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
                                                       where x.id = r.transferencia_id and x.empresa_id = r.empresa_id))
                   or (r.fluxo_versao_id is not null and not exists (select 1 from public.voz_fluxo_versoes x
                                                       where x.id = r.fluxo_versao_id and x.empresa_id = r.empresa_id))) then
        raise exception 'referência de outra empresa';
    end if;
    insert into public.voz_chamadas as v (
        empresa_id, credor_id, lote_id, onda_id, id_chamada, canal, id_cliente, id_acao, destino_mascara, destino_hash,
        tentativa, modo, provedor, conversa_ref, ocorrido_em, atendida_em, encerrada_em, duracao_s, billsec, causa_sip,
        causa_q850, dialstatus, amd, resultado_ia, resultado_operador, resultado, origem_resultado, destino,
        identidade_confirmada, transferencia, transferida_em, transferencia_id, minutos_ia, no_pico, tronco_id,
        tech_prefix, data_promessa, valor_promessa, retorno_em, roteiro_id, roteiro_versao, tem_gravacao, transcricao,
        fluxo_versao_id, bloco_final)
    select r.empresa_id, r.credor_id, r.lote_id, r.onda_id, r.id_chamada, coalesce(r.canal, 'agente_voz'), r.id_cliente,
           r.id_acao, r.destino_mascara, r.destino_hash, coalesce(r.tentativa, 1),
           coalesce(r.modo, (select c.modo from public.voz_config c where c.empresa_id = r.empresa_id), 'simulado'),
           r.provedor, r.conversa_ref, coalesce(r.ocorrido_em, now()), r.atendida_em, r.encerrada_em, r.duracao_s,
           r.billsec, r.causa_sip, r.causa_q850, r.dialstatus, r.amd, r.resultado_ia, r.resultado_operador, r.resultado,
           r.origem_resultado, r.destino, r.identidade_confirmada, r.transferencia, r.transferida_em,
           r.transferencia_id, r.minutos_ia, coalesce(r.no_pico, false), r.tronco_id, r.tech_prefix, r.data_promessa,
           r.valor_promessa, r.retorno_em, r.roteiro_id, r.roteiro_versao, coalesce(r.tem_gravacao, false), r.transcricao,
           r.fluxo_versao_id, r.bloco_final
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
        tem_gravacao = excluded.tem_gravacao or v.tem_gravacao, transcricao = coalesce(excluded.transcricao, v.transcricao),
        fluxo_versao_id = coalesce(excluded.fluxo_versao_id, v.fluxo_versao_id),
        bloco_final = coalesce(excluded.bloco_final, v.bloco_final);
    get diagnostics n = row_count;
    return n;
end $$;


-- escrita: um evento por bloco (upsert por empresa, id_chamada e ordem, como voz/banco.py › CONFLITO). Só códigos.
create or replace function voz_vm.gravar_fluxo_passos(linhas jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare n int; fora text;
begin
    if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) > 5000 then
        raise exception 'linhas: lista de até 5000 passos';
    end if;
    if exists (select 1 from jsonb_array_elements(linhas) e where jsonb_typeof(e) <> 'object') then
        raise exception 'linhas: cada passo é um objeto';
    end if;
    select string_agg(distinct k, ', ' order by k) into fora
      from jsonb_array_elements(linhas) e, jsonb_object_keys(e) k
     where k <> all (array['empresa_id', 'id_chamada', 'fluxo_versao_id', 'ordem', 'bloco_id', 'modo', 'entrou_em',
                           'saida_quando', 'intencao', 'confianca_faixa', 'motivo_devolucao', 'trava', 'turnos']);
    if fora is not null then
        raise exception 'colunas que a VM não grava em voz_fluxo_passos: %', fora;
    end if;
    if exists (select 1 from jsonb_populate_recordset(null::public.voz_fluxo_passos, linhas) r
                where r.empresa_id is null or not voz_vm.tem_voz(r.empresa_id)) then
        raise exception 'empresa sem voz configurada';
    end if;
    if exists (select 1 from jsonb_populate_recordset(null::public.voz_fluxo_passos, linhas) r
                where not exists (select 1 from public.voz_fluxo_versoes x
                                   where x.id = r.fluxo_versao_id and x.empresa_id = r.empresa_id)) then
        raise exception 'referência de outra empresa';
    end if;
    insert into public.voz_fluxo_passos as p (empresa_id, id_chamada, fluxo_versao_id, ordem, bloco_id, modo, entrou_em,
                                              saida_quando, intencao, confianca_faixa, motivo_devolucao, trava, turnos)
    select r.empresa_id, r.id_chamada, r.fluxo_versao_id, r.ordem, r.bloco_id, r.modo, coalesce(r.entrou_em, now()),
           r.saida_quando, r.intencao, r.confianca_faixa, r.motivo_devolucao, r.trava, r.turnos
      from jsonb_populate_recordset(null::public.voz_fluxo_passos, linhas) r
    on conflict (empresa_id, id_chamada, ordem) do update set
        fluxo_versao_id = excluded.fluxo_versao_id, bloco_id = excluded.bloco_id, modo = excluded.modo,
        entrou_em = excluded.entrou_em, saida_quando = excluded.saida_quando, intencao = excluded.intencao,
        confianca_faixa = excluded.confianca_faixa, motivo_devolucao = excluded.motivo_devolucao,
        trava = excluded.trava, turnos = excluded.turnos;
    get diagnostics n = row_count;
    return n;
end $$;

-- escrita: uma linha por tentativa de conector. LGPD: só códigos, status, tempo e contagens; nenhuma coluna recebe o
-- corpo da resposta do CRM, e chave fora da lista (dados, ofertas, corpo...) é recusada, não ignorada.
create or replace function voz_vm.gravar_crm_chamadas(linhas jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare n int; fora text;
begin
    if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) > 5000 then
        raise exception 'linhas: lista de até 5000 chamadas de conector';
    end if;
    if exists (select 1 from jsonb_array_elements(linhas) e where jsonb_typeof(e) <> 'object') then
        raise exception 'linhas: cada chamada de conector é um objeto';
    end if;
    select string_agg(distinct k, ', ' order by k) into fora
      from jsonb_array_elements(linhas) e, jsonb_object_keys(e) k
     where k <> all (array['empresa_id', 'conector_id', 'conector_versao', 'id_chamada', 'id_cliente', 'fluxo_versao_id',
                           'bloco_id', 'tentativa', 'http_status', 'classe', 'latencia_ms', 'resultado_codigo',
                           'ofertas_acima_alcada', 'usou_alternativa']);
    if fora is not null then
        raise exception 'colunas que a VM não grava em crm_chamadas: %', fora;
    end if;
    if exists (select 1 from jsonb_populate_recordset(null::public.crm_chamadas, linhas) r
                where r.empresa_id is null or not voz_vm.tem_voz(r.empresa_id)) then
        raise exception 'empresa sem voz configurada';
    end if;
    if exists (select 1 from jsonb_populate_recordset(null::public.crm_chamadas, linhas) r
                where (r.conector_id is not null and not exists (select 1 from public.crm_conectores x
                                                                 where x.id = r.conector_id and x.empresa_id = r.empresa_id))
                   or (r.fluxo_versao_id is not null and not exists (select 1 from public.voz_fluxo_versoes x
                                                       where x.id = r.fluxo_versao_id and x.empresa_id = r.empresa_id))) then
        raise exception 'referência de outra empresa';
    end if;
    insert into public.crm_chamadas (empresa_id, conector_id, conector_versao, id_chamada, id_cliente, fluxo_versao_id,
                                     bloco_id, tentativa, http_status, classe, latencia_ms, resultado_codigo,
                                     ofertas_acima_alcada, usou_alternativa)
    select r.empresa_id, r.conector_id, r.conector_versao, r.id_chamada, r.id_cliente, r.fluxo_versao_id, r.bloco_id,
           coalesce(r.tentativa, 1), r.http_status, r.classe, r.latencia_ms, r.resultado_codigo,
           coalesce(r.ofertas_acima_alcada, 0), coalesce(r.usou_alternativa, false)
      from jsonb_populate_recordset(null::public.crm_chamadas, linhas) r;
    get diagnostics n = row_count;
    return n;
end $$;

-- o que o papel executa (o resto de voz_vm continua como o SQL 57 deixou)
do $$
declare f regprocedure;
begin
    for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'voz_vm'::regnamespace loop
        execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    end loop;
end $$;
grant execute on function voz_vm.gravar_chamadas(jsonb), voz_vm.gravar_fluxo_passos(jsonb), voz_vm.gravar_crm_chamadas(jsonb),
                          voz_vm.fluxo_em_uso(jsonb), voz_vm.alcada_vigente(jsonb), voz_vm.pegar_pedido_fluxo(jsonb),
                          voz_vm.registrar_geracao_fluxo(jsonb), voz_vm.anexos_fluxo_vencidos(jsonb),
                          voz_vm.marcar_anexos_apagados(jsonb) to motorcx_voz;
