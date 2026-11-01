-- SQL 63 · Speech Analytics: ligações da IA, temas novos, oferta e resultado por motivo (o que faltava do SQL 62).
-- 1. Ligações da IA analisadas com o texto da própria conversa (decisão 21: sem custo de transcrição). Cada provedor
--    (Montagem MotorCX, ElevenLabs e Simulador) entrega a conversa por turno; a VM mascara (CPF, cartão, e-mail,
--    telefone, sequências de dígitos e nomes) e grava em /var/motorcx/transcricoes/empresa_<id>/ia_<id da chamada>.json
--    (voz/transcricao/ia.py). A gravação da IA (que já subia para o bucket, agora com o nome
--    credor_<id>/<AAAA>/<MM>/<DD>/ia_<id da chamada>.wav) passa a ser registrada em voz_gravacoes, com origem 'ia': o
--    nome do arquivo da gravação sem extensão é o mesmo <ref> da transcrição, e é assim que speech_contexto_voz casa as
--    duas (regra 3). O Whisper nunca transcreve ligação da IA (ref ia_…). O texto fica só na VM e vai embora em 90
--    dias, como o do Whisper. registrar_gravacoes_ia_voz pega cliente, carteira e ação da própria voz_chamadas.
-- 2. Temas novos (decisão 7 do SQL 60): toda semana a VM agrupa os trechos mascarados do cliente que ficaram sem tema
--    e sem intenção (trechos_para_temas_voz), pelos embeddings da busca semântica quando há pgvector (o mesmo
--    modelo da busca semântica, Vertex em São Paulo, 1536 dimensões) ou por palavras quando não há. Grupo com 30 conversas ou mais
--    vira tema 'novo' com um item 'tema' na Curadoria e um nome SUGERIDO pela IA; o nome de verdade e a promoção
--    continuam sendo da pessoa com curadoria_voz. Grupo com menos de 30 nunca aparece (propor_tema_voz recusa).
--    Grupo parecido com um tema que já existe entra nele (sem item novo). voz_temas_trechos guarda quais trechos
--    formaram cada tema (vai embora com o trecho, logo com a gravação) e a semana do tema conta códigos + grupos
--    (recalcular_temas_semana, chamado também pelo job noturno). Tema descartado na Curadoria fica 'descartado'.
-- 3. Dimensão 'oferta' em voz_conversao_dia: o código da PRIMEIRA oferta apresentada pelo fluxo (bloco oferta ou
--    generativa › apresentar_oferta), só parcelas e faixa de desconto ("6x", "avista_d10_20"), nunca valor; quando o
--    CRM não devolveu oferta (crm_chamadas: ofertas_0 ou oferta_acima_alcada), 'sem_oferta'. O código chega pela
--    transcrição da IA e entra em voz_analise_chamadas.codigos.oferta (codigos_speech_ok passa a aceitar). O funil
--    "oferta" também conta quem recebeu oferta pelo fluxo.
-- 4. voz_resultado_por_motivo: pagou em até 30 dias (quitação ou 1ª parcela, a mesma regra da propensão) por motivo,
--    gravado pelo motor (nuvem/resultado_motivo.py, chave do servidor) com os pagamentos que só o motor tem
--    (base/pagamentos.csv). Só agregados e só dias com os 30 dias fechados. O site lê só pela função
--    resultado_por_motivo_voz (grupo < 30 sem número); a leitura direta da tabela sai. A retroalimentação lê a mesma
--    janela de 28 dias deslocada 30 dias para trás (só dias fechados).
-- Uso de IA (SQL 60, decisão 8 revista, e SQL 61): embeddings dos trechos e dos temas e o nome sugerido entram pelo
-- registrar_uso_ia_voz (componentes embeddings e temas), com quantidade e custo real, sem cobrar minuto a mais (o
-- minuto analisado já cobre). Premissas de custo, só se ainda não houver: embeddings US$ 0,15 por milhão de tokens de
-- entrada × R$ 5,60 = R$ 0,00084 por mil; temas (o mesmo LLM do avaliador) R$ 0,00336 por mil.
-- Acesso próprio (SQL 57): as funções novas da VM têm a versão em voz_vm com validação por linha (motorcx_voz).
-- Depende dos SQL 56, 57, 58, 60, 61 e 62. Pode rodar de novo sem erro. ORDEM: rode depois do SQL 62; se o 56, 60 ou
-- 62 for rodado de novo, rode este depois.
--
-- Conferência (no SQL Editor do Supabase, depois de rodar):
--   select (select count(*) from pg_tables where schemaname = 'public' and tablename = 'voz_temas_trechos'
--             and rowsecurity) as tabela_com_rls,                                                         -- 1
--          public.codigos_speech_ok('{"oferta": "6x_d10_20"}') as oferta_ok,                              -- true
--          public.codigos_speech_ok('{"oferta": "R$ 150"}') as valor_nunca,                               -- false
--          has_table_privilege('authenticated', 'public.voz_resultado_por_motivo', 'select') as site_le_motivo, -- false
--          has_function_privilege('authenticated', 'public.resultado_por_motivo_voz(bigint,bigint,date,date)', 'execute')
--            as site_le_pela_funcao,                                                                       -- true
--          has_function_privilege('motorcx_voz', 'voz_vm.registrar_gravacoes_ia(jsonb)', 'execute')
--            and has_function_privilege('motorcx_voz', 'voz_vm.trechos_para_temas(jsonb)', 'execute')
--            and has_function_privilege('motorcx_voz', 'voz_vm.propor_tema(jsonb)', 'execute')
--            and not has_table_privilege('motorcx_voz', 'public.voz_temas_trechos', 'select') as vm_ok,    -- true
--          has_function_privilege('authenticated', 'public.propor_tema_voz(bigint,date,jsonb)', 'execute') as site_propoe, -- false
--          (select count(*) from public.custos_ia_voz where componente in ('embeddings', 'temas')) >= 2 as custos; -- true

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

-- ================================================================ 0. premissas de custo (o Master troca em custos_ia_voz)
insert into public.custos_ia_voz (componente, por_mil_entrada, por_mil_saida, por_minuto, vigente_desde)
select 'embeddings', 0.00084, 0, 0, date '2025-12-01'
 where not exists (select 1 from public.custos_ia_voz where componente = 'embeddings');
insert into public.custos_ia_voz (componente, por_mil_entrada, por_mil_saida, por_minuto, vigente_desde)
select 'temas', 0.00336, 0.00336, 0, date '2025-12-01'
 where not exists (select 1 from public.custos_ia_voz where componente = 'temas');

-- ================================================================ 1. gravação da ligação da IA em voz_gravacoes
-- linhas: [{empresa_id, id_chamada, caminho, duracao_s}] (até 500). Cliente, carteira e ação vêm
-- da voz_chamadas da própria empresa (a VM não manda id_cliente). Chamada que ainda não chegou ao banco volta em
-- sem_chamada (a VM tenta de novo). Upsert por empresa e caminho; a validade é do gatilho (retenção da empresa).
create or replace function public.registrar_gravacoes_ia_voz(linhas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    fora text;
    n int;
    faltam jsonb;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz registram a gravação da IA';
    end if;
    if jsonb_typeof(linhas) is distinct from 'array' or jsonb_array_length(linhas) > 500
       or exists (select 1 from jsonb_array_elements(linhas) e where jsonb_typeof(e) <> 'object') then
        raise exception 'linhas: lista de até 500 objetos';
    end if;
    select string_agg(distinct k, ', ' order by k) into fora
      from jsonb_array_elements(linhas) e, jsonb_object_keys(e) k
     where k <> all (array['empresa_id', 'id_chamada', 'caminho', 'duracao_s']);
    if fora is not null then
        raise exception 'campos que a VM não manda na gravação da IA: %', fora;
    end if;
    if exists (select 1 from jsonb_to_recordset(linhas) r(empresa_id bigint, id_chamada text, caminho text, duracao_s int)
                where r.empresa_id is null or coalesce(r.id_chamada, '') !~ '^[A-Za-z0-9_.:\-]{4,80}$'
                   or coalesce(r.caminho, '') !~ '^[A-Za-z0-9_\-/.]+$' or char_length(r.caminho) > 300
                   or r.caminho ~ '[0-9]{10,}'
                   or regexp_replace(r.caminho, '^.*/|\.[^./]*$', '', 'g') <> 'ia_' || r.id_chamada
                   or r.duracao_s < 0 or r.duracao_s > 36000) then
        raise exception 'linha de gravação da IA fora do padrão (…/ia_<id da chamada>.wav, sem sequência de 10 dígitos)';
    end if;
    with r as (
        select x.*, (select v.id from public.voz_chamadas v where v.empresa_id = x.empresa_id and v.id_chamada = x.id_chamada
                      order by v.id limit 1) as chamada
          from jsonb_to_recordset(linhas) x(empresa_id bigint, id_chamada text, caminho text, duracao_s int)),
    ins as (
        insert into public.voz_gravacoes as g (empresa_id, credor_id, chamada_id, id_cliente, id_acao, origem, caminho,
                                               duracao_s, gravada_em)
        select r.empresa_id, v.credor_id, v.id, v.id_cliente, v.id_acao, 'ia', r.caminho, r.duracao_s,
               coalesce(v.atendida_em, v.ocorrido_em)
          from r join public.voz_chamadas v on v.id = r.chamada
        on conflict (empresa_id, caminho) do update set
            chamada_id = coalesce(g.chamada_id, excluded.chamada_id),
            duracao_s = coalesce(excluded.duracao_s, g.duracao_s)
        returning g.chamada_id)
    select count(*) into n from ins;
    update public.voz_chamadas v set tem_gravacao = true
      from jsonb_to_recordset(linhas) x(empresa_id bigint, id_chamada text)
     where v.empresa_id = x.empresa_id and v.id_chamada = x.id_chamada and not v.tem_gravacao;
    select coalesce(jsonb_agg(x.id_chamada order by x.id_chamada), '[]'::jsonb) into faltam
      from jsonb_to_recordset(linhas) x(empresa_id bigint, id_chamada text)
     where not exists (select 1 from public.voz_chamadas v where v.empresa_id = x.empresa_id and v.id_chamada = x.id_chamada);
    return jsonb_build_object('gravadas', n, 'sem_chamada', faltam);
end $$;

-- ================================================================ 2. oferta nos códigos da análise (só parcelas e faixa de desconto)
--   oferta   "avista" | "<n>x" (n de 2 a 99), com "_d<faixa>" quando houve desconto (1_10, 10_20, 20_30, 30_50, 50_mais)
select pg_temp.trocar('public.codigos_speech_ok(jsonb)',
$de$        elsif k = 'temas' then$de$,
$para$        elsif k = 'oferta' then                                  -- SQL 63: primeira oferta do fluxo, sem valor
            if jsonb_typeof(v) <> 'string'
               or v #>> '{}' !~ '^(avista|([2-9]|[1-9][0-9])x)(_d(1_10|10_20|20_30|30_50|50_mais))?$' then
                return false;
            end if;
        elsif k = 'temas' then$para$);

-- ================================================================ 3. trechos que formaram cada tema (clusterização semanal)
create table if not exists public.voz_temas_trechos (
    id           bigint generated always as identity primary key,
    empresa_id   bigint not null references public.empresas (id) on delete cascade,
    tema_id      bigint not null references public.voz_temas (id) on delete cascade,
    trecho_id    bigint not null references public.voz_trechos (id) on delete cascade,
    chamada_id   bigint not null references public.voz_chamadas (id) on delete cascade,
    credor_id    bigint references public.credores (id) on delete set null,
    dia          date not null,
    semana       date not null check (extract(isodow from semana) = 1),
    criado_em    timestamptz not null default now(),
    unique (trecho_id)
);
create index if not exists voz_temas_trechos_tema on public.voz_temas_trechos (tema_id, dia);
create index if not exists voz_temas_trechos_semana on public.voz_temas_trechos (empresa_id, semana);
comment on table public.voz_temas_trechos is
    'SQL 63: trechos mascarados que a clusterização semanal pôs em cada tema (só ids). Vai embora com o trecho (logo, com a gravação).';
alter table public.voz_temas_trechos enable row level security;
revoke all on public.voz_temas_trechos from anon, authenticated;
grant all on public.voz_temas_trechos to service_role;

-- a semana de cada tema: ligações com o código do tema (avaliador) + ligações dos trechos agrupados no tema
create or replace function public.recalcular_temas_semana(empresa bigint, semana date) returns int
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    n int;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz recalculam os temas';
    end if;
    if semana is null or extract(isodow from semana) <> 1 then
        raise exception 'semana: a segunda-feira';
    end if;
    delete from public.voz_temas_semana x where x.empresa_id = empresa and x.semana = semana;
    insert into public.voz_temas_semana (empresa_id, credor_id, semana, tema_id, conversas, com_acordo)
    select empresa, m.cr, semana, m.tema, count(*),
           count(*) filter (where ch.resultado = 'promessa' or ch.data_promessa is not null)
      from (select coalesce(a.credor_id, 0) as cr, t::bigint as tema, a.chamada_id
              from public.voz_analise_chamadas a
              cross join lateral jsonb_array_elements_text(coalesce(a.codigos -> 'temas', '[]')) t
             where a.empresa_id = empresa and a.situacao = 'ok' and a.dia between semana and semana + 6
               and exists (select 1 from public.voz_temas x where x.id = t::bigint and x.empresa_id = empresa)
            union
            select coalesce(m.credor_id, 0), m.tema_id, m.chamada_id
              from public.voz_temas_trechos m
             where m.empresa_id = empresa and m.dia between semana and semana + 6) m
      join public.voz_chamadas ch on ch.id = m.chamada_id
     group by m.cr, m.tema;
    get diagnostics n = row_count;
    return n;
end $$;

-- o job noturno (agregar_speech_dia) passa a contar também os grupos e a dimensão oferta
select pg_temp.trocar('public.agregar_speech_dia(bigint,date)',
$de$    -- temas da semana (segunda a domingo), refeita inteira
    delete from public.voz_temas_semana x where x.empresa_id = empresa and x.semana = semana;
    insert into public.voz_temas_semana (empresa_id, credor_id, semana, tema_id, conversas, com_acordo)
    select empresa, coalesce(a.credor_id, 0), semana, t::bigint, count(*),
           count(*) filter (where ch.resultado = 'promessa' or ch.data_promessa is not null)
      from public.voz_analise_chamadas a
      join public.voz_chamadas ch on ch.id = a.chamada_id
      cross join lateral jsonb_array_elements_text(coalesce(a.codigos -> 'temas', '[]')) t
     where a.empresa_id = empresa and a.situacao = 'ok' and a.dia between semana and semana + 6
       and exists (select 1 from public.voz_temas x where x.id = t::bigint and x.empresa_id = empresa)
     group by coalesce(a.credor_id, 0), t::bigint;
    get diagnostics n_temas = row_count;$de$,
$para$    -- temas da semana (segunda a domingo), refeita inteira: códigos + grupos da clusterização (SQL 63)
    n_temas := public.recalcular_temas_semana(empresa, semana);$para$);
select pg_temp.trocar('public.agregar_speech_dia(bigint,date)',
$de$               coalesce(av.itens ->> 'ck_oferta' = 'sim', false) as ofereceu,$de$,
$para$               (coalesce(av.itens ->> 'ck_oferta' = 'sim', false) or a.codigos ? 'oferta') as ofereceu,   -- SQL 63
               (select k.resultado_codigo from public.crm_chamadas k
                 where k.empresa_id = a.empresa_id and k.id_chamada = ch.id_chamada
                   and k.resultado_codigo in ('ofertas_0', 'ofertas_1_3', 'ofertas_4_mais', 'oferta_acima_alcada')
                 order by k.ocorrido_em desc, k.id desc limit 1) as crm_ofertas,$para$);
select pg_temp.trocar('public.agregar_speech_dia(bigint,date)',
$de$            union all select 'canal_preferido', b.codigos ->> 'canal_preferido' where b.codigos ? 'canal_preferido'$de$,
$para$            union all select 'oferta', b.codigos ->> 'oferta' where b.codigos ? 'oferta'          -- SQL 63
            union all select 'oferta', 'sem_oferta'
                       where not b.codigos ? 'oferta' and b.crm_ofertas in ('ofertas_0', 'oferta_acima_alcada')
            union all select 'canal_preferido', b.codigos ->> 'canal_preferido' where b.codigos ? 'canal_preferido'$para$);

-- ================================================================ 4. clusterização semanal (VM): entrada e saída
-- trechos do CLIENTE da semana (segunda a domingo), de ligações analisadas sem tema e sem intenção (ou com a intenção
-- em dúvida na Curadoria), dentro da retenção e ainda fora de qualquer tema; e uma amostra (até 40 trechos) de cada
-- tema que já existe, para o grupo parecido entrar nele. Só texto mascarado e ids; o vetor só com pgvector.
create or replace function public.trechos_para_temas_voz(empresa bigint, semana date, limite int default 4000) returns jsonb
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_variable
declare
    com_vetor boolean := exists (select 1 from pg_attribute a where a.attrelid = 'public.voz_trechos'::regclass
                                    and a.attname = 'embedding' and not a.attisdropped);
    emb text := case when com_vetor then 't.embedding::text' else 'null::text' end;
    trechos jsonb;
    temas jsonb;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz leem os trechos para os temas';
    end if;
    if semana is null or extract(isodow from semana) <> 1 then
        raise exception 'semana: a segunda-feira';
    end if;
    if not exists (select 1 from public.voz_config c where c.empresa_id = empresa and c.speech_analytics) then
        return jsonb_build_object('ligado', false, 'vetor', com_vetor, 'trechos', '[]'::jsonb, 'temas', '[]'::jsonb);
    end if;
    execute format($q$
        select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', z.id, 'chamada_id', z.chamada_id,
                                                                      'texto', z.texto_redigido, 'emb', z.emb))
                                  order by z.id), '[]'::jsonb)
          from (select t.id, a.chamada_id, t.texto_redigido, %1$s as emb
                  from public.voz_trechos t
                  join public.voz_analise_chamadas a on a.gravacao_id = t.gravacao_id and a.empresa_id = t.empresa_id
                 where t.empresa_id = $1 and t.falante = 'cliente' and t.expira_em > now()
                   and a.situacao = 'ok' and a.dia between $2 and $2 + 6
                   and not (a.codigos ? 'temas')
                   and (not (a.codigos ? 'intencao')
                        or exists (select 1 from public.voz_curadoria_itens c
                                    where c.chamada_id = a.chamada_id and c.tipo = 'intencao' and c.situacao = 'aberto'))
                   and not exists (select 1 from public.voz_temas_trechos m where m.trecho_id = t.id)
                 order by t.id desc limit $3) z$q$, emb)
      into trechos using empresa, semana, greatest(1, least(coalesce(limite, 4000), 8000));
    execute format($q$
        select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'situacao', x.situacao, 'trechos', x.amostra)
                                  order by x.id), '[]'::jsonb)
          from (select v.id, v.situacao,
                       (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('texto', s.texto_redigido, 'emb', s.emb))),
                                        '[]'::jsonb)
                          from (select t.texto_redigido, %1$s as emb
                                  from public.voz_temas_trechos m join public.voz_trechos t on t.id = m.trecho_id
                                 where m.tema_id = v.id order by m.id desc limit 40) s) as amostra
                  from public.voz_temas v
                 where v.empresa_id = $1
                   and exists (select 1 from public.voz_temas_trechos m where m.tema_id = v.id)) x$q$, emb)
      into temas using empresa;
    return jsonb_build_object('ligado', true, 'vetor', com_vetor, 'trechos', trechos, 'temas', temas);
end $$;

-- tema: {tema_id (opcional: o grupo entra num tema que já existe), sugestao (nome sugerido pela IA, opcional),
--        trechos [ids], exemplo (id de um dos trechos)}. Tema novo só com 30 conversas ou mais; nasce 'novo', sem
-- nome, com um item 'tema' na Curadoria (o nome é sempre de uma pessoa: curar_item_voz).
create or replace function public.propor_tema_voz(empresa bigint, semana date, tema jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    fora text;
    ids bigint[];
    tid bigint;
    novo boolean;
    conversas int;
    validos int;
    sug text;
    exemplo text;
    existente public.voz_temas;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz propõem temas';
    end if;
    if semana is null or extract(isodow from semana) <> 1 then
        raise exception 'semana: a segunda-feira';
    end if;
    if not exists (select 1 from public.voz_config c where c.empresa_id = empresa and c.speech_analytics) then
        raise exception 'Speech Analytics desligado para esta empresa';
    end if;
    if jsonb_typeof(tema) is distinct from 'object' then
        raise exception 'tema: um objeto';
    end if;
    select string_agg(k, ', ' order by k) into fora from jsonb_object_keys(tema) k
     where k <> all (array['tema_id', 'sugestao', 'trechos', 'exemplo']);
    if fora is not null then
        raise exception 'campos que o tema não grava: %', fora;
    end if;
    if jsonb_typeof(tema -> 'trechos') is distinct from 'array' or jsonb_array_length(tema -> 'trechos') = 0
       or jsonb_array_length(tema -> 'trechos') > 5000
       or exists (select 1 from jsonb_array_elements(tema -> 'trechos') x where jsonb_typeof(x) <> 'number') then
        raise exception 'trechos: lista de 1 a 5000 ids';
    end if;
    ids := array(select distinct (x #>> '{}')::bigint from jsonb_array_elements(tema -> 'trechos') x);
    -- os trechos têm de ser do cliente, desta empresa, de ligação analisada nesta semana e ainda sem tema
    select count(*), count(distinct a.chamada_id) into validos, conversas
      from public.voz_trechos t
      join public.voz_analise_chamadas a on a.gravacao_id = t.gravacao_id and a.empresa_id = t.empresa_id and a.situacao = 'ok'
     where t.id = any (ids) and t.empresa_id = empresa and t.falante = 'cliente' and a.dia between semana and semana + 6
       and not exists (select 1 from public.voz_temas_trechos m where m.trecho_id = t.id);
    if validos <> cardinality(ids) then
        raise exception 'trecho de outra empresa, de outra semana, que não é do cliente ou que já tem tema';
    end if;
    sug := nullif(trim(tema ->> 'sugestao'), '');
    if sug is not null and (char_length(sug) not between 3 and 60 or sug !~ '^[[:alpha:]][[:alpha:] ,/\-]*$'
                            or not public.texto_mascarado_ok(sug)) then
        raise exception 'nome sugerido: de 3 a 60 letras, sem número nem dado pessoal';
    end if;
    if tema ? 'tema_id' and tema ->> 'tema_id' is not null then
        select * into existente from public.voz_temas x where x.id = (tema ->> 'tema_id')::bigint and x.empresa_id = empresa;
        if existente.id is null then
            raise exception 'tema de outra empresa';
        end if;
        tid := existente.id;
        novo := false;
    else
        if conversas < 30 then
            raise exception 'grupo com menos de 30 conversas não vira tema (tem %)', conversas;
        end if;
        insert into public.voz_temas (empresa_id) values (empresa) returning id into tid;
        novo := true;
    end if;
    insert into public.voz_temas_trechos (empresa_id, tema_id, trecho_id, chamada_id, credor_id, dia, semana)
    select empresa, tid, t.id, a.chamada_id, a.credor_id, a.dia, semana
      from public.voz_trechos t
      join public.voz_analise_chamadas a on a.gravacao_id = t.gravacao_id and a.empresa_id = t.empresa_id and a.situacao = 'ok'
     where t.id = any (ids)
    on conflict (trecho_id) do nothing;
    if novo then
        select left(t.texto_redigido, 600) into exemplo from public.voz_trechos t
         where t.id = coalesce((tema ->> 'exemplo')::bigint, ids[1]) and t.id = any (ids);
        insert into public.voz_curadoria_itens (empresa_id, tipo, tema_id, trecho_redigido, decisao_ia, opcoes)
        values (empresa, 'tema', tid, case when public.texto_mascarado_ok(exemplo) then exemplo end,
                jsonb_strip_nulls(jsonb_build_object('valor', '', 'sugestao', sug, 'conversas', conversas,
                                                     'semana', semana)), '[]'::jsonb);
    end if;
    perform public.recalcular_temas_semana(empresa, semana);
    return jsonb_build_object('tema_id', tid, 'novo', novo, 'conversas', conversas);
end $$;

-- Curadoria: tema descartado fica 'descartado' (some do painel; a clusterização junta o parecido nele sem propor de novo)
select pg_temp.trocar('public.curar_item_voz(bigint,text,text)',
$de$    -- tema: confirmar ou corrigir dá o nome (decisão 7)$de$,
$para$    -- SQL 63: tema descartado sai do painel e não volta como tema novo ("desfazer" devolve para novo)
    if c.tipo = 'tema' and acao = 'descartar' and c.tema_id is not null then
        update public.voz_temas set situacao = 'descartado' where id = c.tema_id and situacao = 'novo';
    end if;
    -- tema: confirmar ou corrigir dá o nome (decisão 7)$para$);

-- o banco tem pgvector? (a VM só calcula embedding dos trechos quando a coluna existe)
create or replace function public.speech_vetor_voz() returns boolean
language sql stable security definer set search_path = public as $$
    select exists (select 1 from pg_attribute a where a.attrelid = 'public.voz_trechos'::regclass
                      and a.attname = 'embedding' and not a.attisdropped)
$$;

-- ================================================================ 5. resultado por motivo (pagou em 30 dias), pelo motor
-- pagamentos: [{id_cliente, data}] de quem pagou (quitação ou 1ª parcela: a regra da propensão) que o motor tem em
-- base/pagamentos.csv. Refaz, para a carteira, os dias de (ate − 60) a (ate − 30): só dias com os 30 dias fechados.
-- Grava só contagens por dia e motivo; os ids de cliente não ficam em lugar nenhum.
create or replace function public.gravar_resultado_por_motivo_voz(empresa bigint, credor bigint, pagamentos jsonb,
                                                                  ate date) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    de_b date := ate - 60;
    ate_b date := ate - 30;
    n int;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o motor grava o resultado por motivo';
    end if;
    if empresa is null or ate is null or ate > (now() at time zone 'America/Sao_Paulo')::date + 1 then
        raise exception 'empresa e data de referência (até amanhã)';
    end if;
    if jsonb_typeof(pagamentos) is distinct from 'array' or jsonb_array_length(pagamentos) > 500000
       or exists (select 1 from jsonb_array_elements(pagamentos) x where jsonb_typeof(x) <> 'object'
                     or char_length(coalesce(x ->> 'id_cliente', '')) not between 1 and 60
                     or coalesce(x ->> 'data', '') !~ '^\d{4}-\d{2}-\d{2}$') then
        raise exception 'pagamentos: lista de {id_cliente, data}';
    end if;
    if credor is not null and not exists (select 1 from public.credores k where k.id = credor and k.empresa_id = empresa) then
        raise exception 'carteira de outra empresa';
    end if;
    delete from public.voz_resultado_por_motivo m
     where m.empresa_id = empresa and m.credor_id = coalesce(credor, 0) and m.data between de_b and ate_b;
    with p as (
        select distinct x ->> 'id_cliente' as idc, (x ->> 'data')::date as d from jsonb_array_elements(pagamentos) x),
    b as (
        select a.dia, a.codigos ->> 'motivo' as motivo, ch.id_cliente,
               (ch.resultado = 'promessa' or ch.data_promessa is not null) as prometeu
          from public.voz_analise_chamadas a
          join public.voz_chamadas ch on ch.id = a.chamada_id
         where a.empresa_id = empresa and a.situacao = 'ok' and a.codigos ? 'motivo'
           and a.dia between de_b and ate_b and coalesce(a.credor_id, 0) = coalesce(credor, 0))
    insert into public.voz_resultado_por_motivo (empresa_id, credor_id, data, motivo, conversas, promessas, pagamentos)
    select empresa, coalesce(credor, 0), b.dia, b.motivo, count(*), count(*) filter (where b.prometeu),
           count(*) filter (where exists (select 1 from p where p.idc = b.id_cliente and p.d between b.dia and b.dia + 30))
      from b group by b.dia, b.motivo;
    get diagnostics n = row_count;
    return jsonb_build_object('de', de_b, 'ate', ate_b, 'linhas', n);
end $$;

-- leitura do site: soma no servidor, grupo com menos de 30 conversas sem número nem percentual
create or replace function public.resultado_por_motivo_voz(empresa bigint, credor bigint, de date, ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_variable
declare
    res jsonb;
begin
    if empresa is null or empresa not in (select public.minhas_empresas()) then
        raise exception 'sem acesso a esta empresa';
    end if;
    if de is null or ate is null or ate < de or ate - de > 366 then
        raise exception 'período de até um ano';
    end if;
    with g as (
        select m.motivo, sum(m.conversas) c, sum(m.promessas) pr, sum(m.pagamentos) pg
          from public.voz_resultado_por_motivo m
         where m.empresa_id = empresa and m.data between de and ate and (credor is null or m.credor_id = credor)
         group by m.motivo),
    t as (select coalesce(sum(c), 0) c, coalesce(sum(pg), 0) pg from g)
    select jsonb_build_object(
               'n', case when t.c >= 30 then t.c end,
               'pagou_pct', public.pct30(t.pg, t.c),
               'motivos', coalesce((select jsonb_agg(jsonb_build_object('valor', g.motivo,
                                                     'n', case when g.c >= 30 then g.c end,
                                                     'promessa_pct', public.pct30(g.pr, g.c),
                                                     'pagou_pct', public.pct30(g.pg, g.c)) order by g.c desc)
                                    from g), '[]'::jsonb))
      into res from t;
    return res;
end $$;

-- o site deixa de ler a tabela direto (grupo pequeno só some pela função)
drop policy if exists voz_resultado_motivo_ver on public.voz_resultado_por_motivo;
revoke all on public.voz_resultado_por_motivo from anon, authenticated;
grant all on public.voz_resultado_por_motivo to service_role;

-- retroalimentação: o "pagou em 30 dias" só existe para dias com os 30 dias fechados
select pg_temp.trocar('public.dados_retroalimentacao_voz(bigint,date,date,boolean)',
$de$where m.empresa_id = empresa and m.data between de and ate), '[]'::jsonb) end,$de$,
$para$where m.empresa_id = empresa and m.data between de - 30 and ate - 30), '[]'::jsonb) end,   -- SQL 63: dias fechados$para$);

revoke all on function public.registrar_gravacoes_ia_voz(jsonb), public.recalcular_temas_semana(bigint, date),
    public.trechos_para_temas_voz(bigint, date, int), public.propor_tema_voz(bigint, date, jsonb),
    public.speech_vetor_voz(), public.gravar_resultado_por_motivo_voz(bigint, bigint, jsonb, date)
    from public, anon, authenticated;
grant execute on function public.registrar_gravacoes_ia_voz(jsonb), public.recalcular_temas_semana(bigint, date),
    public.trechos_para_temas_voz(bigint, date, int), public.propor_tema_voz(bigint, date, jsonb),
    public.speech_vetor_voz(), public.gravar_resultado_por_motivo_voz(bigint, bigint, jsonb, date) to service_role;
revoke all on function public.resultado_por_motivo_voz(bigint, bigint, date, date) from public, anon;
grant execute on function public.resultado_por_motivo_voz(bigint, bigint, date, date) to authenticated;

-- ================================================================ 6. acesso próprio da VM (voz_vm, SQL 57)
-- mesmos argumentos das RPCs do public (um objeto jsonb, como o corpo do PostgREST) e a mesma resposta; toda linha
-- exige empresa com voz configurada (e o resto é conferido nas funções do public).
create or replace function voz_vm.registrar_gravacoes_ia(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    if jsonb_typeof(args -> 'linhas') is distinct from 'array'
       or exists (select 1 from jsonb_array_elements(args -> 'linhas') e
                   where jsonb_typeof(e) <> 'object' or not voz_vm.tem_voz((e ->> 'empresa_id')::bigint)) then
        raise exception 'empresa sem voz configurada';
    end if;
    return public.registrar_gravacoes_ia_voz(args -> 'linhas');
end $$;
create or replace function voz_vm.trechos_para_temas(args jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz configurada';
    end if;
    return public.trechos_para_temas_voz((args ->> 'empresa')::bigint, (args ->> 'semana')::date,
                                         coalesce((args ->> 'limite')::int, 4000));
end $$;
create or replace function voz_vm.propor_tema(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz configurada';
    end if;
    return public.propor_tema_voz((args ->> 'empresa')::bigint, (args ->> 'semana')::date, args -> 'tema');
end $$;
create or replace function voz_vm.recalcular_temas_semana(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz configurada';
    end if;
    return to_jsonb(public.recalcular_temas_semana((args ->> 'empresa')::bigint, (args ->> 'semana')::date));
end $$;
create or replace function voz_vm.speech_vetor(args jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
    select to_jsonb(public.speech_vetor_voz())
$$;

revoke all on function voz_vm.registrar_gravacoes_ia(jsonb), voz_vm.trechos_para_temas(jsonb), voz_vm.propor_tema(jsonb),
    voz_vm.recalcular_temas_semana(jsonb), voz_vm.speech_vetor(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.registrar_gravacoes_ia(jsonb), voz_vm.trechos_para_temas(jsonb), voz_vm.propor_tema(jsonb),
    voz_vm.recalcular_temas_semana(jsonb), voz_vm.speech_vetor(jsonb) to motorcx_voz;
