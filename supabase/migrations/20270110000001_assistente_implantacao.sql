-- SQL 74 · Assistente de implantação (5 passos) e mapeamento das colunas da carga geral pelo site
-- (o SQL 73 é de outro ramo: id do cliente sem CPF e rascunho da fatura; os dois não se tocam)
--
-- Proposta aprovada pelo dono (ux-implantacao): um lugar só, /implantacao, com o progresso salvo no banco.
-- 1. Empresa e contrato (equipe): criar_empresa_implantacao cria TUDO numa transação (empresa, motor, módulos, ciclo
--    padrão, preço da Orquestração por CPF ativo, contato do Admin, progresso). Repetir com a mesma `chave` (o site
--    gera uma por tentativa) devolve a MESMA empresa: o retry nunca cria outra (era o slug "-2" do QA, B4). Com CNPJ de
--    empresa que já existe, devolve a existente (o assistente abre ela). O convite do Admin continua pela função
--    admin-usuarios (cria o usuário no Auth), depois desta chamada; se ele falhar, a empresa fica inteira e o assistente
--    oferece "Reenviar convite".
-- 2. Carteira: salvar_carteira_implantacao RENOMEIA a "Carteira principal" (criada sozinha com a empresa) em vez de
--    criar outra; o identificador (código) não muda. Sem a principal, cria uma com o código gerado do nome.
-- 3. Primeira carga: mapeamento da carga geral por carteira (mapeamento_arquivos.tipo = 'base'), gravado por
--    salvar_mapeamento_base, validado aqui (campos obrigatórios, colunas do último arquivo, uma coluna por campo; o
--    código do cliente nunca é a mesma coluna do CPF). O motor lê o mapeamento salvo antes da detecção automática (o
--    salvo vence; a detecção completa o que faltar). Carga que espera o mapeamento fica "aguardando"; ao salvar, um
--    pedido de rotina (pedidos_rotina) faz o motor processar de novo em segundos.
-- 4. Como acionar: canais_empresa.quem_envia (lista = a empresa baixa a lista e o fornecedor dela envia; motorcx = a
--    Mensageria da MotorCX envia; desligado = canais_empresa.ativo false). NULL = como antes (MotorCX envia o que a
--    Mensageria contratada cobre; o resto sai em lista), para não mudar quem já roda. O assistente grava 'lista' por
--    padrão (decisão do dono). mensageria_config.aprovar_primeiro: "aprovar o primeiro lote, depois automático" (só
--    vale quando a MotorCX envia). Frases padrão do SMS por etapa (tabela frases), editáveis.
-- 5. Pronto para rodar: implantacao_situacao(empresa) devolve, numa leitura, tudo o que a lista "O que falta" precisa
--    (o site só classifica: verde, âmbar, vermelho). Ninguém marca à mão.
-- Nada para anon. Pode rodar de novo sem erro. Sem superusuário e sem OWNER TO (cabe no APLICAR do SQL Editor).

-- ---------------------------------------------------------------- mapeamento da carga geral
alter table public.mapeamento_arquivos drop constraint if exists mapeamento_arquivos_tipo_check;
alter table public.mapeamento_arquivos add constraint mapeamento_arquivos_tipo_check
    check (tipo in ('base', 'ocorrencia', 'acordo', 'baixa', 'canal_sms', 'canal_rcs', 'canal_whatsapp', 'canal_email',
                    'canal_voz'));
comment on column public.mapeamento_arquivos.tipo is
    'base = carga geral (SQL 74: colunas {id_cliente, cpf, id_contrato, saldo, dias_atraso, vencimento, data_entrada, '
    'telefones[], emails[]}); ocorrencia, acordo, baixa e canal_<canal> = retornos.';

-- ---------------------------------------------------------------- quem envia cada canal
alter table public.canais_empresa add column if not exists quem_envia text
    check (quem_envia is null or quem_envia in ('lista', 'motorcx'));
comment on column public.canais_empresa.quem_envia is
    'SQL 74: lista = a empresa baixa a lista do canal e o fornecedor dela envia; motorcx = a Mensageria da MotorCX '
    'envia (precisa do canal contratado). NULL = como antes (MotorCX envia o que a Mensageria cobre). Desligado = ativo.';
alter table public.mensageria_config add column if not exists aprovar_primeiro boolean not null default false;
comment on column public.mensageria_config.aprovar_primeiro is
    'SQL 74: com aprovar_lotes, só o primeiro lote de cada canal espera aprovação; depois de um aprovado, os próximos '
    'saem sozinhos.';

-- ---------------------------------------------------------------- progresso do assistente
create table if not exists public.implantacao_progresso (
    empresa_id     bigint primary key references public.empresas (id) on delete cascade,
    chave          uuid unique,
    passo          int not null default 1 check (passo between 1 and 5),
    feitos         int[] not null default '{}' check (feitos <@ array[1, 2, 3, 4, 5]),
    criado_por     uuid references auth.users (id) on delete set null,
    criado_em      timestamptz not null default now(),
    atualizado_em  timestamptz not null default now()
);
comment on table public.implantacao_progresso is
    'Assistente de implantação (SQL 74): passo em que a pessoa parou e os passos confirmados. O resto do estado vem '
    'do que já aconteceu (implantacao_situacao).';
alter table public.implantacao_progresso enable row level security;
revoke all on public.implantacao_progresso from anon, authenticated;
grant select on public.implantacao_progresso to authenticated;
grant all on public.implantacao_progresso to service_role;
drop policy if exists implantacao_progresso_ver on public.implantacao_progresso;
create policy implantacao_progresso_ver on public.implantacao_progresso for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));

-- quem mexe na implantação de uma empresa: a equipe com a contratação, ou quem da empresa edita carteiras/canais
create or replace function public.pode_implantar(empresa bigint, perm text) returns boolean
language sql stable security definer set search_path = public as $$
    select public.pode_ver_empresa(empresa)
       and (public.admin_equipe() or public.equipe_pode('editar_contratacao', empresa)
            or (not public.sou_equipe() and public.pode(perm)))
$$;
revoke execute on function public.pode_implantar(bigint, text) from public, anon;
grant execute on function public.pode_implantar(bigint, text) to authenticated;

create or replace function public.marcar_passo_implantacao(empresa bigint, passo int, feito boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare p int := greatest(1, least(5, coalesce(marcar_passo_implantacao.passo, 1)));
begin
    if not public.pode_ver_empresa(empresa) then
        raise exception 'empresa fora do seu acesso';
    end if;
    insert into public.implantacao_progresso (empresa_id, passo, feitos, criado_por)
    values (empresa, p, case when feito then array[p] else '{}' end, auth.uid())
    on conflict (empresa_id) do update
       set passo = excluded.passo,
           feitos = case when feito
                         then (select coalesce(array_agg(distinct x order by x), '{}')
                                 from unnest(public.implantacao_progresso.feitos || array[p]) x)
                         else public.implantacao_progresso.feitos end,
           atualizado_em = now();
end $$;
revoke execute on function public.marcar_passo_implantacao(bigint, int, boolean) from public, anon;
grant execute on function public.marcar_passo_implantacao(bigint, int, boolean) to authenticated;

-- ---------------------------------------------------------------- passo 1: empresa e contrato, numa transação
create or replace function public.slug_disponivel(nome text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
    base text := trim(both '-' from regexp_replace(lower(translate(coalesce(nome, ''),
                    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '[^a-z0-9]+', '-', 'g'));
    s text; n int := 1;
begin
    base := left(coalesce(nullif(base, ''), 'empresa'), 34);
    if length(base) < 2 then base := base || '-empresa'; end if;
    base := trim(both '-' from base);
    s := base;
    while exists (select 1 from public.empresas e where e.slug = s) loop
        n := n + 1;
        s := base || '-' || n;
    end loop;
    return s;
end $$;
revoke execute on function public.slug_disponivel(text) from public, anon, authenticated;

create or replace function public.criar_empresa_implantacao(
    chave uuid, nome text, razao_social text, admin_nome text, admin_email text, preco numeric,
    cnpj text default null, minimo numeric default 0, motivo text default null, mensageria boolean default false,
    segmento text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
    eid bigint;
    doc text := nullif(regexp_replace(coalesce(cnpj, ''), '\D', '', 'g'), '');
    mail text := lower(trim(coalesce(admin_email, '')));
    n text := trim(coalesce(nome, ''));
    rs text := trim(coalesce(razao_social, ''));
    an text := trim(coalesce(admin_nome, ''));
begin
    if not (public.admin_equipe() or public.equipe_pode('criar_empresa', null)) then
        raise exception 'só a equipe MotorCX com a permissão de criar empresas faz este passo';
    end if;
    if chave is null then
        raise exception 'tentativa sem identificador: recarregue a página e tente de novo';
    end if;
    -- mesma tentativa (o site reenviou): devolve a empresa já criada, sem criar outra
    select p.empresa_id into eid from public.implantacao_progresso p where p.chave = criar_empresa_implantacao.chave;
    if eid is not null then
        return eid;
    end if;
    if length(n) < 2 then raise exception 'Informe o nome fantasia da empresa.'; end if;
    if length(rs) < 2 then raise exception 'Informe a razão social.'; end if;
    if length(an) < 2 then raise exception 'Informe o nome de quem vai ser o Admin da empresa.'; end if;
    if mail !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'O e-mail do Admin não parece válido.'; end if;
    if preco is null or preco <= 0 then raise exception 'Informe o preço da Orquestração por CPF ativo.'; end if;
    if doc is not null and not public.cnpj_valido(doc) then raise exception 'CNPJ inválido: confira os números.'; end if;
    -- empresa com o mesmo CNPJ já existe: abre ela (não cria outra)
    if doc is not null then
        select e.id into eid from public.empresas e where e.cnpj = doc;
        if eid is not null then
            if not public.pode_ver_empresa(eid) then
                raise exception 'Já existe uma empresa com este CNPJ, fora da sua carteira. Fale com o Master.';
            end if;
            insert into public.implantacao_progresso (empresa_id, chave, passo, criado_por)
            values (eid, criar_empresa_implantacao.chave, 2, auth.uid())
            on conflict (empresa_id) do nothing;
            return eid;
        end if;
    end if;

    insert into public.empresas (slug, nome, razao_social, cnpj, segmento, situacao, ativa, cliente_desde)
    values (public.slug_disponivel(n), n, rs, doc, nullif(segmento, ''), 'implantacao', true, current_date)
    returning id into eid;
    -- motor e módulos (os gatilhos já criam MotorCob + Orquestração; aqui fica explícito e idempotente)
    insert into public.empresa_frentes (empresa_id, frente, ativo) values (eid, 'motorcob', true)
        on conflict (empresa_id, frente) do update set ativo = true;
    insert into public.empresa_modulos (empresa_id, modulo, ativo, canais) values (eid, 'orquestracao', true, '{}')
        on conflict (empresa_id, modulo) do update set ativo = true;
    if coalesce(mensageria, false) then
        insert into public.empresa_modulos (empresa_id, modulo, ativo, canais)
        values (eid, 'mensageria', true, array['sms', 'email'])
        on conflict (empresa_id, modulo) do update set ativo = true;
    end if;
    -- já vem assim: mensal com corte no dia 1, pós-pago, boleto e Pix, 10 dias, a equipe revisa antes de emitir
    insert into public.ciclo_empresa (empresa_id, periodicidade, dia_corte, modelo_pagamento, formas, prazo_dias, emissao)
    values (eid, 'mensal', 1, 'pos', array['boleto', 'pix'], 10, 'revisar')
    on conflict (empresa_id) do nothing;
    -- preço por CPF ativo no mês (as mesmas regras do Console: mínimo da tabela, motivo e quem aprova)
    perform public.salvar_preco(empresa => eid, item => 'contratos', modelo => 'flat', preco => criar_empresa_implantacao.preco,
                                minimo => coalesce(criar_empresa_implantacao.minimo, 0),
                                vigente_desde => public.competencia_de(eid, current_date),
                                motivo => criar_empresa_implantacao.motivo);
    -- o Admin também é o primeiro contato da empresa (quem recebe a fatura a empresa decide no passo 5)
    insert into public.empresa_contatos (empresa_id, nome, email, papel_contrato)
    values (eid, an, mail, 'operacional');
    insert into public.faturamento_sal (empresa_id) values (eid) on conflict (empresa_id) do nothing;
    insert into public.implantacao_progresso (empresa_id, chave, passo, feitos, criado_por)
    values (eid, criar_empresa_implantacao.chave, 2, array[1], auth.uid());
    return eid;
end $$;
revoke execute on function public.criar_empresa_implantacao(uuid, text, text, text, text, numeric, text, numeric, text,
                                                            boolean, text) from public, anon;
grant execute on function public.criar_empresa_implantacao(uuid, text, text, text, text, numeric, text, numeric, text,
                                                           boolean, text) to authenticated;

-- ---------------------------------------------------------------- passo 2: carteira (renomeia a principal)
create or replace function public.salvar_carteira_implantacao(empresa bigint, nome text, entrada text default 'arquivo')
returns table (credor_id bigint, credor_codigo text, credor_nome text)
language plpgsql security definer set search_path = public as $$
declare
    alvo bigint; cod text; n text := trim(coalesce(salvar_carteira_implantacao.nome, '')); base text; k int := 1;
begin
    if not public.pode_implantar(empresa, 'editar_credores') then
        raise exception 'seu perfil não pode editar as carteiras desta empresa';
    end if;
    if length(n) < 2 or length(n) > 80 then
        raise exception 'Dê um nome à carteira (ex.: Banco Horizonte · Cartões).';
    end if;
    if coalesce(entrada, 'arquivo') not in ('arquivo', 'api') then
        raise exception 'como a carga chega: arquivo ou API';
    end if;
    select c.id into alvo from public.credores c
     where c.empresa_id = empresa and c.frente = 'motorcob'
     order by (c.codigo = 'principal') desc, c.id limit 1;
    if alvo is null then
        base := left(trim(both '-' from regexp_replace(lower(translate(n,
                    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '[^a-z0-9]+', '-', 'g')), 36);
        base := coalesce(nullif(base, ''), 'carteira');
        cod := base;
        while exists (select 1 from public.credores c where c.empresa_id = empresa and c.codigo = cod) loop
            k := k + 1; cod := base || '-' || k;
        end loop;
        insert into public.credores (empresa_id, codigo, nome, entrada_carga, ativo)
        values (empresa, cod, n, coalesce(entrada, 'arquivo'), true) returning credores.id into alvo;
    else
        update public.credores c set nome = n, entrada_carga = coalesce(entrada, 'arquivo'), ativo = true,
                                     atualizado_em = now()
         where c.id = alvo;
    end if;
    perform public.marcar_passo_implantacao(empresa, 3, false);
    update public.implantacao_progresso p
       set feitos = (select array_agg(distinct x order by x) from unnest(p.feitos || array[2]) x)
     where p.empresa_id = empresa;
    return query select c.id, c.codigo, c.nome from public.credores c where c.id = alvo;
end $$;
revoke execute on function public.salvar_carteira_implantacao(bigint, text, text) from public, anon;
grant execute on function public.salvar_carteira_implantacao(bigint, text, text) to authenticated;

-- ---------------------------------------------------------------- passo 3: mapeamento das colunas da carga geral
-- colunas: {"id_cliente": "COD", "cpf": "DOC", "id_contrato": "CT", "saldo": "VL", "dias_atraso": "ATR" |
--           "vencimento": "VENC", "data_entrada": "DT", "telefones": ["CEL1", "CEL2"], "emails": ["EMAIL"]}
-- cabecalho: as colunas que o navegador leu do arquivo escolhido (só nomes), antes do envio; sem ele, vale o último
-- arquivo que o motor viu.
drop function if exists public.salvar_mapeamento_base(bigint, jsonb);
create or replace function public.salvar_mapeamento_base(credor bigint, colunas jsonb, cabecalho jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    eid bigint; cab jsonb; k text; v jsonb; col text; usadas text[] := '{}'; faltam text[] := '{}';
    simples constant text[] := array['id_cliente', 'cpf', 'id_contrato', 'saldo', 'dias_atraso', 'vencimento',
                                     'data_entrada'];
    nomes constant jsonb := '{"id_cliente": "o código do cliente", "cpf": "o CPF/CNPJ", "id_contrato": "o contrato",
        "saldo": "o saldo", "dias_atraso": "os dias de atraso", "vencimento": "o vencimento",
        "data_entrada": "a data de entrada", "telefones": "os telefones", "emails": "os e-mails"}';
    limpo jsonb := '{}'; lista jsonb; pediu boolean := false;
begin
    select c.empresa_id into eid from public.credores c where c.id = credor;
    if eid is null or not public.pode_implantar(eid, 'editar_credores') then
        raise exception 'seu perfil não pode mudar as colunas desta carteira';
    end if;
    if colunas is null or jsonb_typeof(colunas) <> 'object' then
        raise exception 'mapeamento inválido: aponte as colunas de novo';
    end if;
    if cabecalho is not null then
        if jsonb_typeof(cabecalho) <> 'array' or jsonb_array_length(cabecalho) > 500
           or exists (select 1 from jsonb_array_elements(cabecalho) x where jsonb_typeof(x) <> 'string'
                         or length(x #>> '{}') > 120) then
            raise exception 'cabeçalho do arquivo inválido: escolha o arquivo de novo';
        end if;
        cab := cabecalho;
    else
        select m.cabecalho into cab from public.mapeamento_arquivos m
         where m.empresa_id = eid and m.credor_id = credor and m.tipo = 'base';
    end if;
    for k, v in select * from jsonb_each(colunas) loop
        if k = any (simples) then
            if jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and trim(v #>> '{}') = '') then
                continue;
            end if;
            if jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 120 then
                raise exception 'Escolha uma coluna do arquivo para %.', nomes ->> k;
            end if;
            col := v #>> '{}';
            if col = any (usadas) then
                raise exception 'A coluna "%" foi apontada para mais de um campo. Cada campo usa uma coluna.', col;
            end if;
            usadas := usadas || col;
            limpo := limpo || jsonb_build_object(k, col);
        elsif k in ('telefones', 'emails') then
            if jsonb_typeof(v) = 'null' then continue; end if;
            if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20 then
                raise exception 'Escolha as colunas de % do arquivo.', nomes ->> k;
            end if;
            lista := '[]';
            for col in select jsonb_array_elements_text(v) loop
                if trim(col) = '' then continue; end if;
                if col = any (usadas) then
                    raise exception 'A coluna "%" foi apontada para mais de um campo. Cada campo usa uma coluna.', col;
                end if;
                usadas := usadas || col;
                lista := lista || to_jsonb(col);
            end loop;
            if jsonb_array_length(lista) > 0 then limpo := limpo || jsonb_build_object(k, lista); end if;
        else
            raise exception 'campo desconhecido no mapeamento: %', left(k, 40);
        end if;
    end loop;
    -- só colunas que existem no último arquivo recebido (quando o motor já leu o cabeçalho)
    if cab is not null and jsonb_typeof(cab) = 'array' and jsonb_array_length(cab) > 0 then
        foreach col in array usadas loop
            if not cab ? col then
                raise exception 'A coluna "%" não está no último arquivo desta carteira. Escolha uma das colunas do arquivo.', col;
            end if;
        end loop;
    end if;
    if not (limpo ? 'id_cliente' or limpo ? 'cpf') then faltam := faltam || 'o código do cliente ou o CPF'::text; end if;
    if not limpo ? 'saldo' then faltam := faltam || 'o saldo'::text; end if;
    if not (limpo ? 'dias_atraso' or limpo ? 'vencimento') then faltam := faltam || 'os dias de atraso ou o vencimento'::text; end if;
    if not (limpo ? 'telefones' or limpo ? 'emails') then faltam := faltam || 'o telefone ou o e-mail'::text; end if;
    if cardinality(faltam) > 0 then
        raise exception 'Falta apontar %: %.', case when cardinality(faltam) = 1 then '1 coluna'
                                                    else cardinality(faltam) || ' colunas' end,
                        array_to_string(faltam, ', ');
    end if;
    insert into public.mapeamento_arquivos (empresa_id, credor_id, tipo, colunas, confirmado, atualizado_em, cabecalho)
    values (eid, credor, 'base', limpo, true, now(), cab)
    on conflict (empresa_id, credor_id, tipo) do update
       set colunas = excluded.colunas, confirmado = true, atualizado_em = now(), atualizado_por = auth.uid(),
           cabecalho = coalesce(excluded.cabecalho, public.mapeamento_arquivos.cabecalho);
    -- carga esperando o mapeamento (ou recusada por coluna): o motor processa de novo em segundos
    if exists (select 1 from public.envios e where e.empresa_id = eid and e.credor_id = credor
                  and e.tipo in ('base', 'incremental') and e.status in ('aguardando', 'erro')
                  and e.enviado_em > now() - interval '30 days'
                  and not exists (select 1 from public.envios d where d.empresa_id = eid and d.credor_id = credor
                                     and d.tipo in ('base', 'incremental') and d.status = 'processado'
                                     and d.enviado_em > e.enviado_em)) then
        insert into public.pedidos_rotina (empresa_id, credor_id) values (eid, credor) on conflict do nothing;
        pediu := true;
    end if;
    perform public.marcar_passo_implantacao(eid, 3, false);
    return jsonb_build_object('colunas', limpo, 'reprocessar', pediu);
end $$;
revoke execute on function public.salvar_mapeamento_base(bigint, jsonb, jsonb) from public, anon;
grant execute on function public.salvar_mapeamento_base(bigint, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- passo 4: como acionar
-- canais: {"whatsapp": "lista" | "motorcx" | "desligado", "sms": ..., "email": ..., "rcs": ..., "discador": ...,
--          "agente_voz": ...}; aprovacao: todo_dia | primeiro | automatico (só com a Mensageria);
-- frases: [{"estagio": "localizacao", "texto": "..."}] (SMS; grava como "Padrão MotorCX · <etapa>")
create or replace function public.salvar_canais_implantacao(empresa bigint, canais jsonb, aprovacao text default null,
                                                            frases jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare
    k text; v text; msg_canais text[]; f jsonb; est text; txt text;
    rotulo constant jsonb := '{"localizacao": "Cliente novo", "cpa": "Deu CPC", "cpb": "CPC sem resposta",
        "giro": "Sem contato (giro)", "preventivo": "Acordo · antes do vencimento", "quebra": "Acordo · parcela vencida"}';
begin
    if not public.pode_implantar(empresa, 'editar_canais') then
        raise exception 'seu perfil não pode mudar os canais desta empresa';
    end if;
    if canais is null or jsonb_typeof(canais) <> 'object' then
        raise exception 'escolha quem envia cada canal';
    end if;
    select m.canais into msg_canais from public.empresa_modulos m
     where m.empresa_id = empresa and m.modulo = 'mensageria' and m.ativo;
    for k, v in select key, value #>> '{}' from jsonb_each(canais) loop
        if k not in ('whatsapp', 'rcs', 'sms', 'email', 'discador', 'agente_voz') then
            raise exception 'canal desconhecido: %', left(k, 30);
        end if;
        if v not in ('lista', 'motorcx', 'desligado') then
            raise exception 'quem envia o %: lista para baixar, MotorCX envia ou desligado', k;
        end if;
        if v = 'motorcx' and (k in ('discador', 'agente_voz') or msg_canais is null or not (k = any (msg_canais))) then
            raise exception 'A MotorCX só envia % com a Mensageria contratada para esse canal. Escolha "lista para baixar".',
                case k when 'sms' then 'SMS' when 'email' then 'e-mail' when 'rcs' then 'RCS' when 'whatsapp' then 'WhatsApp'
                       else 'este canal' end;
        end if;
        insert into public.canais_empresa (empresa_id, canal, ativo, quem_envia)
        values (empresa, k, v <> 'desligado', case when v = 'desligado' then null else v end)
        on conflict (empresa_id, canal) do update
           set ativo = excluded.ativo,
               quem_envia = coalesce(excluded.quem_envia, public.canais_empresa.quem_envia),
               atualizado_em = now(), atualizado_por = auth.uid();
    end loop;
    if aprovacao is not null then
        if aprovacao not in ('todo_dia', 'primeiro', 'automatico') then
            raise exception 'aprovação dos lotes: todo dia, só o primeiro ou automática';
        end if;
        if msg_canais is not null then
            insert into public.mensageria_config (empresa_id, aprovar_lotes, aprovar_primeiro)
            values (empresa, aprovacao <> 'automatico', aprovacao = 'primeiro')
            on conflict (empresa_id) do update
               set aprovar_lotes = excluded.aprovar_lotes, aprovar_primeiro = excluded.aprovar_primeiro,
                   atualizado_em = now(), atualizado_por = auth.uid();
        end if;
    end if;
    if frases is not null then
        if jsonb_typeof(frases) <> 'array' then raise exception 'frases inválidas'; end if;
        for f in select * from jsonb_array_elements(frases) loop
            est := f ->> 'estagio'; txt := trim(coalesce(f ->> 'texto', ''));
            if est is null or not rotulo ? est then raise exception 'etapa desconhecida na frase: %', left(coalesce(est, ''), 30); end if;
            if length(txt) = 0 then continue; end if;
            if length(txt) > 160 then
                raise exception 'A frase do SMS de "%" passa de 160 caracteres (%).', rotulo ->> est, length(txt);
            end if;
            -- uma frase ativa da própria empresa para a etapa vale mais que a padrão: não duplica
            if exists (select 1 from public.frases x where x.empresa_id = empresa and x.canal = 'sms' and x.estagio = est
                          and x.ativo and x.nome <> 'Padrão MotorCX · ' || (rotulo ->> est)) then
                continue;
            end if;
            insert into public.frases (empresa_id, canal, nome, estagio, texto, ativo, origem)
            values (empresa, 'sms', 'Padrão MotorCX · ' || (rotulo ->> est), est, txt, true, 'criado')
            on conflict (empresa_id, canal, nome) do update
               set texto = excluded.texto, estagio = excluded.estagio, ativo = true, atualizado_em = now();
        end loop;
    end if;
    perform public.marcar_passo_implantacao(empresa, 5, false);
    update public.implantacao_progresso p
       set feitos = (select array_agg(distinct x order by x) from unnest(p.feitos || array[4]) x)
     where p.empresa_id = empresa;
end $$;
revoke execute on function public.salvar_canais_implantacao(bigint, jsonb, text, jsonb) from public, anon;
grant execute on function public.salvar_canais_implantacao(bigint, jsonb, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- passo 5: tudo o que a lista "O que falta" precisa
create or replace function public.implantacao_situacao(empresa bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    e record; cred record; comp date; pv record; ult record; carga record; mapa record; adm record;
    hoje date := (now() at time zone 'America/Sao_Paulo')::date; lista record; ve_fat boolean;
    res jsonb;
begin
    if not public.pode_ver_empresa(empresa) then
        raise exception 'empresa fora do seu acesso';
    end if;
    select x.id, x.nome, x.razao_social, x.situacao, x.criada_em, x.slug into e from public.empresas x where x.id = empresa;
    select c.id, c.codigo, c.nome, c.entrada_carga, c.ativo into cred from public.credores c
     where c.empresa_id = empresa and c.frente = 'motorcob' and c.ativo
     order by exists (select 1 from public.envios v where v.credor_id = c.id) desc, (c.codigo = 'principal') desc, c.id
     limit 1;
    comp := public.competencia_de(empresa, hoje);
    select p.preco, p.minimo, p.modelo into pv from public.preco_vigente(empresa, 'contratos', comp) p;
    select x.data_ref, x.status, x.terminada_em, x.resumo, x.erro into ult from public.execucoes x
     where x.empresa_id = empresa and (cred.id is null or x.credor_id = cred.id)
     order by x.iniciada_em desc limit 1;
    select v.id, v.status, v.nome_original, v.enviado_em, v.relatorio, v.tipo into carga from public.envios v
     where v.empresa_id = empresa and (cred.id is null or v.credor_id = cred.id) and v.tipo in ('base', 'incremental')
     order by v.enviado_em desc limit 1;
    select m.colunas, m.confirmado, m.cabecalho, m.sugerido, m.arquivo, m.visto_em into mapa
      from public.mapeamento_arquivos m where m.empresa_id = empresa and m.credor_id = cred.id and m.tipo = 'base';
    select p.id, p.nome, p.email, p.ultimo_acesso into adm from public.perfis p
     where p.empresa_id = empresa and not p.equipe and p.papel = 'admin' order by p.criado_em limit 1;
    select max(f.data) as data into lista from public.fila_dia f where f.empresa_id = empresa
       and (cred.id is null or f.credor_id = cred.id);
    ve_fat := public.ve_faturamento(empresa);
    res := jsonb_build_object(
        'hoje', hoje,
        'empresa', jsonb_build_object('id', e.id, 'nome', e.nome, 'slug', e.slug, 'razao_social', e.razao_social, 'situacao', e.situacao,
                                      'criada_em', e.criada_em),
        'progresso', coalesce((select jsonb_build_object('passo', p.passo, 'feitos', to_jsonb(p.feitos))
                                 from public.implantacao_progresso p where p.empresa_id = empresa),
                              jsonb_build_object('passo', 1, 'feitos', '[]'::jsonb)),
        'preco', case when pv.modelo is null or not ve_fat then null
                      else jsonb_build_object('preco', pv.preco, 'minimo', pv.minimo, 'modelo', pv.modelo) end,
        'admin', jsonb_build_object('id', adm.id, 'convidado', adm.email is not null,
                                    'entrou', adm.ultimo_acesso is not null, 'nome', adm.nome, 'email', adm.email),
        'recebe_fatura', exists (select 1 from public.empresa_contatos c where c.empresa_id = empresa and c.recebe_faturas),
        'contatos', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'email', c.email,
                                                                  'recebe_faturas', c.recebe_faturas) order by c.id)
                                from public.empresa_contatos c where c.empresa_id = empresa), '[]'),
        'carteira', case when cred.id is null then null else jsonb_build_object(
                        'id', cred.id, 'codigo', cred.codigo, 'nome', cred.nome, 'entrada_carga', cred.entrada_carga) end,
        'carteiras', (select count(*) from public.credores c where c.empresa_id = empresa and c.frente = 'motorcob' and c.ativo),
        'carga', case when carga.id is null then null else jsonb_build_object(
                     'id', carga.id, 'tipo', carga.tipo, 'status', carga.status, 'arquivo', carga.nome_original,
                     'enviado_em', carga.enviado_em, 'relatorio', carga.relatorio) end,
        'mapeamento', case when mapa.visto_em is null and mapa.colunas is null then null else jsonb_build_object(
                          'colunas', mapa.colunas, 'confirmado', mapa.confirmado, 'cabecalho', mapa.cabecalho,
                          'sugerido', mapa.sugerido, 'arquivo', mapa.arquivo, 'visto_em', mapa.visto_em) end,
        'execucao', case when ult.data_ref is null then null else jsonb_build_object(
                        'data', ult.data_ref, 'status', ult.status, 'terminada_em', ult.terminada_em,
                        'erro', left(ult.erro, 400),
                        'clientes', ult.resumo -> 'clientes', 'na_carga', ult.resumo -> 'na_carga',
                        'contatos', ult.resumo -> 'contatos', 'fila', ult.resumo -> 'fila',
                        'sem_acao', ult.resumo -> 'sem_acao') end,
        'lista', case when lista.data is null then null else jsonb_build_object(
                     'data', lista.data,
                     'acoes', (select count(*) from public.fila_dia f where f.empresa_id = empresa and f.data = lista.data
                                  and not f.reserva and (cred.id is null or f.credor_id = cred.id)),
                     'clientes', (select count(distinct f.id_cliente) from public.fila_dia f where f.empresa_id = empresa
                                     and f.data = lista.data and not f.reserva
                                     and (cred.id is null or f.credor_id = cred.id)),
                     'por_canal', (select jsonb_object_agg(x.canal, x.n) from (
                                     select f.canal, count(*) n from public.fila_dia f where f.empresa_id = empresa
                                        and f.data = lista.data and not f.reserva
                                        and (cred.id is null or f.credor_id = cred.id) group by f.canal) x)) end,
        'canais', coalesce((select jsonb_object_agg(c.canal, jsonb_build_object('ativo', c.ativo, 'quem_envia', c.quem_envia))
                              from public.canais_empresa c where c.empresa_id = empresa), '{}'),
        'mensageria', jsonb_build_object(
            'contratada', public.modulo_ativo(empresa, 'mensageria'),
            'canais', coalesce((select to_jsonb(m.canais) from public.empresa_modulos m
                                 where m.empresa_id = empresa and m.modulo = 'mensageria' and m.ativo), '[]'),
            'modo', (select c.modo from public.mensageria_config c where c.empresa_id = empresa),
            'aprovar_lotes', (select c.aprovar_lotes from public.mensageria_config c where c.empresa_id = empresa),
            'aprovar_primeiro', (select c.aprovar_primeiro from public.mensageria_config c where c.empresa_id = empresa),
            'pedido_aberto', exists (select 1 from public.pedidos_envio_real r where r.empresa_id = empresa
                                        and r.canal = 'mensageria' and r.situacao = 'aberto')),
        'agente_voz', public.modulo_ativo(empresa, 'agente_voz'),
        'frases_sms', coalesce((select jsonb_agg(distinct f.estagio) from public.frases f
                                 where f.empresa_id = empresa and f.canal = 'sms' and f.ativo and f.estagio is not null), '[]'),
        'ocorrencia_mapeada', exists (select 1 from public.mapeamento_arquivos m where m.empresa_id = empresa
                                         and m.tipo = 'ocorrencia' and m.confirmado),
        'equipe_convidada', exists (select 1 from public.perfis p where p.empresa_id = empresa and not p.equipe
                                       and p.papel <> 'admin')
                            or exists (select 1 from public.empresa_passos_pulados x where x.empresa_id = empresa
                                          and x.passo = 'equipe'),
        'estrategias', (select count(*) from public.estrategias s where s.empresa_id = empresa
                          and coalesce(s.frente, 'motorcob') = 'motorcob'),
        'previa', case when not ve_fat or pv.modelo is null then null else (
                    select jsonb_build_object('competencia', comp, 'cpfs', coalesce(sum(p.quantidade) filter (where p.item = 'orquestracao'), 0),
                                              'preco', pv.preco, 'valor', coalesce(sum(p.valor), 0))
                      from public.previa_fatura(empresa, comp) p where p.item in ('orquestracao', 'orquestracao_minimo')) end
    );
    return res;
end $$;
revoke execute on function public.implantacao_situacao(bigint) from public, anon;
grant execute on function public.implantacao_situacao(bigint) to authenticated;

-- quem recebe a fatura, direto do passo 5 (o Admin marca um contato que já existe ou escreve outro e-mail)
create or replace function public.definir_contato_fatura(empresa bigint, email text, nome text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare mail text := lower(trim(coalesce(email, ''))); cid bigint;
begin
    if not public.pode_implantar(empresa, 'gerenciar_usuarios') then
        raise exception 'seu perfil não pode mudar os contatos da empresa';
    end if;
    if mail !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then
        raise exception 'O e-mail de quem recebe a fatura não parece válido.';
    end if;
    select c.id into cid from public.empresa_contatos c where c.empresa_id = empresa and lower(c.email) = mail
     order by c.id limit 1;
    if cid is null then
        insert into public.empresa_contatos (empresa_id, nome, email, papel_contrato, recebe_faturas)
        values (empresa, coalesce(nullif(trim(nome), ''), 'Financeiro'), mail, 'financeiro', true) returning id into cid;
    else
        update public.empresa_contatos c set recebe_faturas = true, atualizado_em = now() where c.id = cid;
    end if;
    return cid;
end $$;
revoke execute on function public.definir_contato_fatura(bigint, text, text) from public, anon;
grant execute on function public.definir_contato_fatura(bigint, text, text) to authenticated;
