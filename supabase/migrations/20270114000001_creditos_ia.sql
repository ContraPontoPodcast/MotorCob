-- SQL 78 · Créditos de IA: franquia, contador e excedente (etapa 4 da IA na Orquestração)
--
-- Decisão do dono (07/11/2026, DECISOES_IA › Créditos de IA; SPEC do Especialista §11): cada empresa tem uma franquia
-- mensal de 100 créditos de IA incluída no contrato, no CICLO do faturamento da empresa (ciclo_empresa.dia_corte; sem
-- linha = mês fechado); acima dela, cada crédito é cobrado como EXCEDENTE, a um preço único por crédito. O cliente vê
-- quantidades (e o preço do excedente), nunca o custo; o custo real fica com o Master (Console › Margem › IA). Nunca
-- bloqueia, exceto com o teto opcional por empresa que o Master põe no Console.
-- Vale para os usos NOVOS de IA do cliente (Especialista de Estratégia e "Descrever segmentos e régua" / "Descrever a
-- estratégia", etapas 5 e 6). Os itens por função que já existem (ia_geracao_fluxo, ia_roleplay, Speech Analytics…)
-- continuam como estão (SPEC §11.4).
--
-- 1. Catálogo: item `ia_creditos` (eh_ia, unidade "crédito", produto "ia", franquia_padrao 100) e `ia_sem_credito`
--    (custo da IA que não gasta crédito: standby, pré-análise, explicar; nunca faturado, inativo no catálogo).
--    cobranca_itens.franquia_padrao (unidades incluídas por ciclo) e precos_empresa.franquia (nulo = a do item; preço
--    novo da empresa herda a franquia da vigência anterior). O guarda da margem (SQL 61) continua conferindo só o preço
--    das unidades pagas.
-- 2. Preço do excedente = preco_tabela de `ia_creditos` (ou o preço da empresa em precos_empresa): R$ 1,90 proposto,
--    nunca abaixo de preco_minimo_ia('ia_creditos') = custo por crédito ÷ (1 − impostos − 70%). O % de impostos é o de
--    parametros_margem.impostos_pct (Console › Margem; aguardando o contador): NADA aqui fixa imposto. Custo inicial
--    (premissa, SPEC §11.3) = p95 por crédito, US$ 0,10 ≈ R$ 0,56; com impostos 0% o mínimo é R$ 1,87 e a tabela fica
--    em R$ 1,90; com impostos maiores, a tabela nasce no mínimo que o banco calcular.
-- 3. Pesos (ia_creditos_funcoes; mudar peso = commit): análise 2 · Descrever segmentos e régua 2 · Descrever a
--    estratégia 2 · pergunta 1 · pré-análise, standby (plantão), explicar, respostas por opção e resposta guardada 0.
-- 4. ia_creditos_uso: uma linha por pedido (`pedido_ref` único: `esp:analise:<id>`, `seg:geracao:<id>`,
--    `esp:pergunta:<id>`…; a mesma chave nunca conta duas vezes). reservar_creditos_ia → confirmar_creditos_ia (na
--    transação que grava o resultado) ou estornar_creditos_ia (falhou / não entregou); reserva parada há mais de 15 min
--    é estornada (estornar_creditos_ia_vencidos, plantão a cada 10 min) e deixa de contar. Confirmar uma reserva
--    vencida (o resultado chegou depois) volta a contar. Uso de peso 0 também gera linha (conta "usos" na tela), sem
--    crédito. Sem custo nesta tabela: o custo real vai para consumo_ia (Master), por registrar_consumo_ia.
-- 5. Fatura: o crédito confirmado entra em consumo_mensageria (item ia_creditos, na competência do ciclo da empresa);
--    previa_fatura (e por ela gerar_rascunhos/fechar_fatura/estimativa) mostra "Créditos de IA (franquia de 100,
--    incluída no contrato)" sem valor e "Créditos de IA excedentes · N × R$ X" = greatest(0, usados − franquia) × preço.
--    margem_ia passa a calcular a receita de ia_creditos já sem a franquia.
-- 6. Contador: view ia_creditos_ciclo (empresa, ciclo, usados, franquia, excedente, projeção = usados + média dos
--    últimos 7 dias × dias que faltam no ciclo, renova_em, teto, preço do excedente); uso_ia_empresa(empresa,
--    competencia) monta a tela Empresa › Uso de IA (por função e por dia; só quantidade). Quem vê: quem vê a empresa.
-- 7. Avisos no sino (avisos, para = 'empresa'), uma vez por ciclo cada: 80% e 100% da franquia.
-- 8. Teto opcional (empresa_limites_ia.teto_creditos_ciclo, só o Master): acima dele a reserva é recusada com
--    "Limite de IA da sua empresa atingido neste mês; fale com o suporte." e nada é reservado.
-- 9. Master: margem_creditos_ia(competência) por empresa (usados, franquia, excedente, receita, custo dos créditos do
--    cliente, custo da IA do sistema, custo da franquia (vai na mensalidade), MC do excedente, %MC do conjunto, teto) e
--    salvar_limites_creditos_ia(empresa, franquia, teto). margem_ia compara a receita do excedente com o custo só das
--    unidades pagas (fracao_paga_ia); o custo da franquia não entra na margem da revenda.
-- Segurança: RLS em todas as tabelas novas; o site nunca grava crédito direto (só security definer com permissão).
-- Depende dos SQL 25 (faturamento), 30, 34 (avisos), 47 (ciclo), 61 (margem da IA) e 69. Pode rodar de novo sem
-- erro. Se o SQL 61 ou o 69 forem rodados de novo depois deste, rode este de novo (eles recriam margem_ia e
-- previa_fatura sem os trechos daqui).

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

-- ================================================================ 1. catálogo e franquia
alter table public.cobranca_itens
    add column if not exists franquia_padrao int not null default 0 check (franquia_padrao >= 0);
comment on column public.cobranca_itens.franquia_padrao is
    'Unidades incluídas por ciclo (descontadas antes do preço) quando a empresa não tem franquia própria. SQL 78.';
alter table public.precos_empresa
    add column if not exists franquia int check (franquia is null or franquia >= 0);
comment on column public.precos_empresa.franquia is
    'Unidades incluídas por ciclo, descontadas antes do preço (nulo = franquia_padrao do item). SQL 78.';

insert into public.cobranca_itens (codigo, produto, nome, unidade, ordem, descricao, franquia_padrao, ativo) values
    ('ia_creditos', 'ia', 'Créditos de IA', 'crédito', 58,
     'Especialista e Descrever: franquia por ciclo incluída; acima dela, excedente por crédito.', 100, true),
    ('ia_sem_credito', 'ia', 'IA sem crédito (standby, pré-análise)', 'uso', 59,
     'Custo da IA que não gasta crédito do cliente. Nunca faturado.', 0, false)
on conflict (codigo) do nothing;
update public.cobranca_itens set eh_ia = true where codigo in ('ia_creditos', 'ia_sem_credito') and not eh_ia;

-- custo inicial (premissa; só se o item ainda não tiver custo). O Master troca em Console › Margem › IA.
insert into public.custos_ia (item, custo_unitario, moeda, cotacao, vigente_desde, premissa)
select v.item, v.custo, 'USD', 5.60, date '2026-11-01', v.premissa
  from (values
    ('ia_creditos', 0.10::numeric, 'Premissa SQL 78: custo p95 por crédito, US$ 0,10 ≈ R$ 0,56 (análise com saída longa e correção; SPEC 11.3). Trocar pelo realizado depois de 90 dias de consumo.'),
    ('ia_sem_credito', 0.10, 'Premissa SQL 78: standby (análise após a rotina) p95 ≈ R$ 0,56 por uso; pré-análise ≈ R$ 0,01. Com o custo real da chamada, vale o real.')
  ) v(item, custo, premissa)
 where exists (select 1 from public.cobranca_itens i where i.codigo = v.item and i.eh_ia)
   and not exists (select 1 from public.custos_ia c where c.item = v.item);

-- preço de tabela do excedente: R$ 1,90 (proposta do dono), nunca abaixo do mínimo da IA com os impostos de hoje
update public.cobranca_itens i
   set preco_minimo = public.preco_minimo_ia('ia_creditos'),
       preco_tabela = greatest(1.90, public.preco_minimo_ia('ia_creditos'))
 where i.codigo = 'ia_creditos' and i.preco_tabela is null and public.preco_minimo_ia('ia_creditos') is not null;

-- preço novo da empresa herda a franquia da vigência anterior (salvar_preco apaga e grava a vigência)
create or replace function public.herdar_franquia_preco() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.franquia is null then
        select p.franquia into new.franquia from public.precos_empresa p
         where p.empresa_id = new.empresa_id and p.item = new.item and p.vigente_desde < new.vigente_desde
         order by p.vigente_desde desc limit 1;
    end if;
    return new;
end $$;
drop trigger if exists herdar_franquia_preco on public.precos_empresa;
create trigger herdar_franquia_preco before insert on public.precos_empresa
    for each row execute function public.herdar_franquia_preco();

-- ================================================================ 2. pesos por função
create table if not exists public.ia_creditos_funcoes (
    funcao    text primary key check (funcao ~ '^[a-z_]{2,30}$'),
    nome      text not null check (char_length(trim(nome)) between 2 and 80),
    grupo     text not null check (char_length(trim(grupo)) between 2 and 80),
    creditos  int not null check (creditos between 0 and 20),
    sistema   boolean not null default false,
    ordem     int not null default 100
);
comment on table public.ia_creditos_funcoes is
    'Créditos por uso de cada função de IA (decisão do dono; mudar peso = commit). grupo = linha da tela Uso de IA.';
insert into public.ia_creditos_funcoes (funcao, nome, grupo, creditos, sistema, ordem) values
    ('analise',              'Especialista · análise',                    'Especialista · análise (Consultar / Analisar de novo)', 2, false, 10),
    ('pergunta',             'Especialista · pergunta nova',              'Especialista · pergunta nova', 1, false, 20),
    ('descrever_segmentos',  'Descrever segmentos e régua',               'Descrever segmentos e régua (cada geração)', 2, false, 30),
    ('descrever_estrategia', 'Descrever a estratégia',                    'Descrever a estratégia (cada geração)', 2, false, 40),
    ('pre_analise',          'Pré-análise ao salvar ou aplicar',          'Pré-análise ao salvar ou aplicar', 0, false, 50),
    ('plantao',              'Standby após a rotina',                     'Standby após a rotina (iniciativa do sistema)', 0, true, 60),
    ('explicar',             'Explicar melhor',                           'Explicar melhor · respostas guardadas · responder opções', 0, false, 70),
    ('respostas_opcao',      'Responder perguntas por opção',             'Explicar melhor · respostas guardadas · responder opções', 0, false, 71),
    ('cache',                'Resposta guardada',                         'Explicar melhor · respostas guardadas · responder opções', 0, false, 72)
on conflict (funcao) do update
    set nome = excluded.nome, grupo = excluded.grupo, creditos = excluded.creditos, sistema = excluded.sistema,
        ordem = excluded.ordem;
alter table public.ia_creditos_funcoes enable row level security;
drop policy if exists ia_creditos_funcoes_ver on public.ia_creditos_funcoes;
create policy ia_creditos_funcoes_ver on public.ia_creditos_funcoes for select to authenticated using (true);
revoke all on public.ia_creditos_funcoes from anon;
revoke insert, update, delete, truncate on public.ia_creditos_funcoes from authenticated;

-- ================================================================ 3. uso (reserva, confirmação, estorno)
create table if not exists public.ia_creditos_uso (
    id              bigint generated always as identity primary key,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    competencia     date not null check (extract(day from competencia) = 1),
    ciclo_inicio    date not null,
    dia             date not null,
    funcao          text not null references public.ia_creditos_funcoes (funcao),
    creditos        int not null check (creditos >= 0),
    origem          text not null check (origem in ('usuario', 'sistema')),
    usuario_id      uuid references auth.users (id) on delete set null,
    pedido_ref      text not null unique check (pedido_ref ~ '^[a-z]{2,12}:[a-z_]{2,30}:[A-Za-z0-9_.:-]{1,80}$'),
    situacao        text not null default 'reservado' check (situacao in ('reservado', 'confirmado', 'estornado')),
    criado_em       timestamptz not null default now(),
    confirmado_em   timestamptz,
    estornado_em    timestamptz,
    motivo_estorno  text check (motivo_estorno is null or char_length(motivo_estorno) <= 200),
    custo_registrado boolean not null default false,
    check (situacao <> 'confirmado' or confirmado_em is not null),
    check (situacao <> 'estornado' or estornado_em is not null)
);
comment on table public.ia_creditos_uso is
    'Uso de IA por pedido (créditos e situação). Só quantidade, nunca custo (o custo vai para consumo_ia). SQL 78.';
alter table public.ia_creditos_uso add column if not exists custo_registrado boolean not null default false;
comment on column public.ia_creditos_uso.custo_registrado is 'O custo real já foi para consumo_ia (confirmar de novo não soma). Sem valor aqui.';
comment on column public.ia_creditos_uso.pedido_ref is
    'Chave do pedido (esp:analise:<id>, seg:geracao:<id>, esp:pergunta:<id>…): a mesma chave nunca conta duas vezes.';
create index if not exists ia_creditos_uso_ciclo on public.ia_creditos_uso (empresa_id, competencia, situacao);
create index if not exists ia_creditos_uso_reservados on public.ia_creditos_uso (criado_em) where situacao = 'reservado';
alter table public.ia_creditos_uso enable row level security;
drop policy if exists ia_creditos_uso_ver on public.ia_creditos_uso;
create policy ia_creditos_uso_ver on public.ia_creditos_uso for select to authenticated using (public.admin_equipe());
revoke all on public.ia_creditos_uso from anon;
revoke insert, update, delete, truncate on public.ia_creditos_uso from authenticated;

-- teto opcional por empresa (só o Master)
create table if not exists public.empresa_limites_ia (
    empresa_id           bigint primary key references public.empresas (id) on delete cascade,
    teto_creditos_ciclo  int check (teto_creditos_ciclo is null or teto_creditos_ciclo > 0),
    atualizado_em        timestamptz not null default now(),
    atualizado_por       uuid default auth.uid() references auth.users (id) on delete set null
);
comment on table public.empresa_limites_ia is
    'Teto opcional de créditos de IA por ciclo (só o Master). Acima dele a ação de IA não reserva. SQL 78.';
alter table public.empresa_limites_ia enable row level security;
drop policy if exists empresa_limites_ia_ver on public.empresa_limites_ia;
create policy empresa_limites_ia_ver on public.empresa_limites_ia for select to authenticated using (public.admin_equipe());
revoke all on public.empresa_limites_ia from anon;
revoke insert, update, delete, truncate on public.empresa_limites_ia from authenticated;
drop trigger if exists z_auditar on public.empresa_limites_ia;
create trigger z_auditar after insert or update or delete on public.empresa_limites_ia
    for each row execute function public.auditar();

-- ================================================================ 4. contas do ciclo
-- franquia e preço do excedente da empresa na competência (preço da empresa se houver; senão a tabela do item)
create or replace function public.creditos_ia_condicoes(empresa bigint, competencia date)
returns table (franquia int, preco numeric, preco_id bigint)
language sql stable security definer set search_path = public as $$
    select coalesce(p.franquia, i.franquia_padrao, 0)::int,
           case when p.id is null then i.preco_tabela
                when p.modelo = 'flat' then p.preco
                else (select min(f.preco) from public.precos_faixas f where f.preco_id = p.id) end,
           p.id
      from public.cobranca_itens i
      left join lateral (select x.* from public.preco_vigente(creditos_ia_condicoes.empresa, 'ia_creditos',
                                                              creditos_ia_condicoes.competencia) x
                          where x.id is not null) p on true
     where i.codigo = 'ia_creditos'
$$;

-- valor dos créditos usados no ciclo: só o excedente (usados − franquia) é cobrado. Mesmo formato de valor_item.
create or replace function public.valor_creditos_ia(empresa bigint, qtd numeric, competencia date)
returns table (valor numeric, preco_medio numeric, modelo text, minimo numeric, detalhe text)
language plpgsql stable security definer set search_path = public as $$
declare
    c record;
    exc numeric;
begin
    select * into c from public.creditos_ia_condicoes(empresa, competencia);
    if c.franquia is null then
        return;
    end if;
    exc := greatest(0, coalesce(qtd, 0) - c.franquia);
    if c.preco_id is not null then
        return query select v.valor, case when exc > 0 then v.preco_medio else c.preco end, v.modelo, 0::numeric,
                            'franquia de ' || c.franquia || ' incluída'
                       from public.valor_item(empresa, 'ia_creditos', exc, competencia) v;
    elsif c.preco is not null then
        return query select round(exc * c.preco, 2), c.preco, 'flat'::text, 0::numeric,
                            'franquia de ' || c.franquia || ' incluída';
    end if;
end $$;

-- créditos que contam no ciclo: confirmados + reservas com menos de 15 min
create or replace function public.creditos_ia_usados(empresa bigint, competencia date) returns int
language sql stable security definer set search_path = public as $$
    select coalesce(sum(u.creditos), 0)::int from public.ia_creditos_uso u
     where u.empresa_id = creditos_ia_usados.empresa and u.competencia = creditos_ia_usados.competencia
       and (u.situacao = 'confirmado' or (u.situacao = 'reservado' and u.criado_em > now() - interval '15 minutes'))
$$;

-- o servidor (service_role, ou o SQL Editor/rotina sem papel) passa; o site precisa ver a empresa
create or replace function public.servidor_ia() returns boolean
language sql stable as $$
    select coalesce(nullif(current_setting('role', true), ''), 'none') in ('service_role', 'none')
$$;

-- resumo do ciclo de hoje (alimenta o contador). hoje = data de Brasília.
create or replace function public.resumo_creditos_ia_em(empresa bigint, hoje date)
returns table (competencia date, inicio date, fim date, renova_em date, usados int, franquia int, excedente int,
               media_7d numeric, projecao int, teto int, preco_excedente numeric)
language plpgsql stable security definer set search_path = public as $$
declare
    comp date;
    ini date;
    fi date;
    c record;
    u int;
    sete numeric;
begin
    if not (public.servidor_ia() or public.pode_ver_empresa(empresa)) then
        return;
    end if;
    comp := public.competencia_de(empresa, hoje);
    select x.inicio, x.fim into ini, fi from public.ciclo_de(empresa, comp) x;
    select * into c from public.creditos_ia_condicoes(empresa, comp);
    u := public.creditos_ia_usados(empresa, comp);
    select coalesce(sum(x.creditos), 0) into sete from public.ia_creditos_uso x
     where x.empresa_id = resumo_creditos_ia_em.empresa and x.dia between hoje - 6 and hoje
       and (x.situacao = 'confirmado' or (x.situacao = 'reservado' and x.criado_em > now() - interval '15 minutes'));
    return query select comp, ini, fi, fi + 1, u, coalesce(c.franquia, 0), greatest(0, u - coalesce(c.franquia, 0)),
                        round(sete / 7, 2), (u + round(sete / 7 * greatest(fi - hoje, 0)))::int,
                        (select l.teto_creditos_ciclo from public.empresa_limites_ia l
                          where l.empresa_id = resumo_creditos_ia_em.empresa),
                        c.preco;
end $$;

drop view if exists public.ia_creditos_ciclo;
create view public.ia_creditos_ciclo with (security_invoker = true) as
select e.id as empresa_id, r.competencia, r.inicio, r.fim, r.renova_em, r.usados, r.franquia, r.excedente, r.media_7d,
       r.projecao, r.teto, r.preco_excedente
  from public.empresas e
 cross join lateral public.resumo_creditos_ia_em(e.id, (now() at time zone 'America/Sao_Paulo')::date) r;
comment on view public.ia_creditos_ciclo is
    'Créditos de IA no ciclo de hoje por empresa (só quantidade e o preço do excedente; nunca custo). SQL 78.';

-- ================================================================ 5. reservar, confirmar, estornar
create or replace function public.reservar_creditos_ia_em(empresa bigint, funcao text, pedido_ref text, origem text,
                                                         usuario uuid, hoje date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    f public.ia_creditos_funcoes;
    ja public.ia_creditos_uso;
    comp date;
    ini date;
    fi date;
    c record;
    antes int;
    novo int;
    lim int;
    sit text;
begin
    select * into f from public.ia_creditos_funcoes x where x.funcao = reservar_creditos_ia_em.funcao;
    if f.funcao is null then
        raise exception 'função de IA desconhecida: %', reservar_creditos_ia_em.funcao;
    end if;
    if reservar_creditos_ia_em.origem not in ('usuario', 'sistema') then
        raise exception 'origem inválida: %', reservar_creditos_ia_em.origem;
    end if;
    -- uma reserva por empresa por vez (teto e avisos sem corrida)
    perform pg_advisory_xact_lock(hashtextextended('creditos_ia:' || reservar_creditos_ia_em.empresa, 78));
    select * into ja from public.ia_creditos_uso x where x.pedido_ref = reservar_creditos_ia_em.pedido_ref;
    comp := public.competencia_de(reservar_creditos_ia_em.empresa, hoje);
    select x.inicio, x.fim into ini, fi from public.ciclo_de(reservar_creditos_ia_em.empresa, comp) x;
    select * into c from public.creditos_ia_condicoes(reservar_creditos_ia_em.empresa, comp);
    if ja.id is not null then
        if ja.empresa_id <> reservar_creditos_ia_em.empresa then
            raise exception 'pedido de IA de outra empresa';
        end if;
        novo := public.creditos_ia_usados(ja.empresa_id, ja.competencia);
        return jsonb_build_object('ok', true, 'repetido', true, 'pedido_ref', ja.pedido_ref, 'creditos', ja.creditos,
                                  'situacao', ja.situacao, 'usados', novo, 'franquia', c.franquia,
                                  'excedente', greatest(0, novo - c.franquia), 'renova_em', fi + 1,
                                  'preco_excedente', c.preco);
    end if;
    antes := public.creditos_ia_usados(reservar_creditos_ia_em.empresa, comp);
    select l.teto_creditos_ciclo into lim from public.empresa_limites_ia l
     where l.empresa_id = reservar_creditos_ia_em.empresa;
    if f.creditos > 0 and lim is not null and antes + f.creditos > lim then
        return jsonb_build_object('ok', false, 'motivo', 'teto', 'creditos', f.creditos, 'usados', antes,
                                  'franquia', c.franquia, 'teto', lim, 'renova_em', fi + 1,
                                  'mensagem', 'Limite de IA da sua empresa atingido neste mês; fale com o suporte.');
    end if;
    sit := case when f.creditos = 0 then 'confirmado' else 'reservado' end;
    insert into public.ia_creditos_uso (empresa_id, competencia, ciclo_inicio, dia, funcao, creditos, origem, usuario_id,
                                        pedido_ref, situacao, confirmado_em)
    values (reservar_creditos_ia_em.empresa, comp, ini, hoje, f.funcao, f.creditos, reservar_creditos_ia_em.origem,
            reservar_creditos_ia_em.usuario, reservar_creditos_ia_em.pedido_ref, sit,
            case when sit = 'confirmado' then now() end);
    novo := antes + f.creditos;
    -- avisos no sino da empresa, uma vez por ciclo cada (a chave única segura a repetição)
    if f.creditos > 0 and c.franquia > 0 then
        if antes < c.franquia and novo >= c.franquia then
            insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
            values ('empresa', reservar_creditos_ia_em.empresa, 'atencao',
                    format('A franquia de %s créditos de IA deste mês acabou', c.franquia),
                    format('A partir de agora, cada crédito é cobrado como excedente: %s. Nada fica bloqueado. A franquia renova em %s.',
                           public.texto_preco_ia(c.preco), to_char(fi + 1, 'DD/MM')),
                    '/empresa/uso-ia', format('creditos_ia:%s:%s:100', reservar_creditos_ia_em.empresa, comp))
            on conflict (chave) where chave is not null do nothing;
        elsif antes < ceil(c.franquia * 0.8) and novo >= ceil(c.franquia * 0.8) then
            insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
            values ('empresa', reservar_creditos_ia_em.empresa, 'atencao',
                    format('Créditos de IA: %s de %s no mês (aviso de 80%%)', novo, c.franquia),
                    format('Nada é bloqueado: acima de %s, cada crédito vai para a fatura como excedente (%s). A franquia renova em %s.',
                           c.franquia, public.texto_preco_ia(c.preco), to_char(fi + 1, 'DD/MM')),
                    '/empresa/uso-ia', format('creditos_ia:%s:%s:80', reservar_creditos_ia_em.empresa, comp))
            on conflict (chave) where chave is not null do nothing;
        end if;
    end if;
    return jsonb_build_object('ok', true, 'repetido', false, 'pedido_ref', reservar_creditos_ia_em.pedido_ref,
                              'creditos', f.creditos, 'situacao', sit, 'usados', novo, 'franquia', c.franquia,
                              'excedente', greatest(0, novo - c.franquia),
                              'excedente_neste', greatest(0, least(f.creditos, novo - c.franquia)),
                              'renova_em', fi + 1, 'teto', lim, 'preco_excedente', c.preco);
end $$;

-- reserva (ao enfileirar uma análise/geração ou ao chamar uma pergunta). Site: quem vê a empresa; "Descrever" pede
-- editar_orquestracao; o standby é só do sistema. Servidor (VM/Edge Function): origem e usuário informados.
create or replace function public.reservar_creditos_ia(empresa bigint, funcao text, pedido_ref text,
                                                      origem text default 'usuario', usuario uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    o text := coalesce(reservar_creditos_ia.origem, 'usuario');
    u uuid := reservar_creditos_ia.usuario;
begin
    if not public.servidor_ia() then
        if auth.uid() is null or not public.pode_ver_empresa(reservar_creditos_ia.empresa) then
            raise exception 'sem permissão para usar a IA desta empresa';
        end if;
        if reservar_creditos_ia.funcao like 'descrever\_%' and not public.pode('editar_orquestracao') then
            raise exception 'sem permissão: "Descrever" pede a permissão de editar a orquestração';
        end if;
        if exists (select 1 from public.ia_creditos_funcoes x where x.funcao = reservar_creditos_ia.funcao and x.sistema) then
            raise exception 'função de IA só do sistema: %', reservar_creditos_ia.funcao;
        end if;
        o := 'usuario';
        u := auth.uid();
    end if;
    return public.reservar_creditos_ia_em(reservar_creditos_ia.empresa, reservar_creditos_ia.funcao,
                                          reservar_creditos_ia.pedido_ref, o, u,
                                          (now() at time zone 'America/Sao_Paulo')::date);
end $$;

-- confirma na mesma transação que grava o resultado. O custo real (tokens ou custo_real em R$) vai para consumo_ia
-- (Master); o crédito vai para a fatura (consumo_mensageria, competência do ciclo). Idempotente.
create or replace function public.confirmar_creditos_ia(pedido_ref text, tokens bigint default null,
                                                       custo_real numeric default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    r public.ia_creditos_uso;
begin
    select * into r from public.ia_creditos_uso x where x.pedido_ref = confirmar_creditos_ia.pedido_ref for update;
    if r.id is null then
        raise exception 'pedido de IA sem reserva: %', confirmar_creditos_ia.pedido_ref;
    end if;
    if r.situacao = 'estornado' and coalesce(r.motivo_estorno, '') not like 'reserva vencida%' then
        raise exception 'pedido de IA estornado (%): não confirma', coalesce(r.motivo_estorno, 'sem motivo');
    end if;
    if r.situacao <> 'confirmado' then
        update public.ia_creditos_uso x
           set situacao = 'confirmado', confirmado_em = now(), estornado_em = null, motivo_estorno = null
         where x.id = r.id;
        if r.creditos > 0 then
            insert into public.consumo_mensageria as m (empresa_id, competencia, item, quantidade)
            values (r.empresa_id, r.competencia, 'ia_creditos', r.creditos)
            on conflict (empresa_id, competencia, item) do update
                set quantidade = m.quantidade + excluded.quantidade, atualizado_em = now();
        end if;
    end if;
    -- custo real, uma vez por pedido (sem faturar: a fatura recebe o crédito acima)
    if not r.custo_registrado then
        if r.creditos > 0 then
            perform public.registrar_consumo_ia(r.empresa_id, 'ia_creditos', r.creditos, confirmar_creditos_ia.tokens,
                                                confirmar_creditos_ia.custo_real, false, r.competencia);
            update public.ia_creditos_uso x set custo_registrado = true where x.id = r.id;
        elsif coalesce(confirmar_creditos_ia.tokens, 0) > 0 or coalesce(confirmar_creditos_ia.custo_real, 0) > 0 then
            perform public.registrar_consumo_ia(r.empresa_id, 'ia_sem_credito', 1, confirmar_creditos_ia.tokens,
                                                confirmar_creditos_ia.custo_real, false, r.competencia);
            update public.ia_creditos_uso x set custo_registrado = true where x.id = r.id;
        end if;
    end if;
    if r.situacao = 'confirmado' and r.custo_registrado then
        return jsonb_build_object('ok', true, 'repetido', true, 'situacao', 'confirmado', 'creditos', r.creditos);
    end if;
    return jsonb_build_object('ok', true, 'repetido', false, 'situacao', 'confirmado', 'creditos', r.creditos);
end $$;

-- estorna o que falhou ou não entregou nada (só reserva; crédito confirmado não volta)
create or replace function public.estornar_creditos_ia(pedido_ref text, motivo text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    r public.ia_creditos_uso;
begin
    select * into r from public.ia_creditos_uso x where x.pedido_ref = estornar_creditos_ia.pedido_ref for update;
    if r.id is null then
        return jsonb_build_object('ok', false, 'situacao', null);
    end if;
    if r.situacao <> 'reservado' then
        return jsonb_build_object('ok', r.situacao = 'estornado', 'situacao', r.situacao);
    end if;
    update public.ia_creditos_uso x
       set situacao = 'estornado', estornado_em = now(),
           motivo_estorno = left(coalesce(nullif(trim(estornar_creditos_ia.motivo), ''), 'falhou ou não entregou'), 200)
     where x.id = r.id;
    return jsonb_build_object('ok', true, 'situacao', 'estornado', 'creditos', r.creditos);
end $$;

-- job (plantão, a cada 10 min): reserva parada há mais de 15 min é estornada
create or replace function public.estornar_creditos_ia_vencidos() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
    update public.ia_creditos_uso x
       set situacao = 'estornado', estornado_em = now(), motivo_estorno = 'reserva vencida (15 min sem resultado)'
     where x.situacao = 'reservado' and x.criado_em <= now() - interval '15 minutes';
    get diagnostics n = row_count;
    return n;
end $$;

-- uso de uma vez (reserva + confirma): standby, pré-análise, resposta guardada, explicar. Só o servidor.
create or replace function public.registrar_uso_ia(empresa bigint, funcao text, pedido_ref text, tokens bigint default null,
                                                  custo_real numeric default null, origem text default 'sistema',
                                                  usuario uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
    r := public.reservar_creditos_ia_em(registrar_uso_ia.empresa, registrar_uso_ia.funcao, registrar_uso_ia.pedido_ref,
                                        coalesce(registrar_uso_ia.origem, 'sistema'), registrar_uso_ia.usuario,
                                        (now() at time zone 'America/Sao_Paulo')::date);
    if not (r ->> 'ok')::boolean then
        return r;
    end if;
    return r || public.confirmar_creditos_ia(registrar_uso_ia.pedido_ref, registrar_uso_ia.tokens, registrar_uso_ia.custo_real);
end $$;

-- ================================================================ 6. tela Empresa › Uso de IA (só quantidade)
create or replace function public.uso_ia_empresa_em(empresa bigint, competencia date, hoje date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    comp date := coalesce(public.competencia_de(empresa, uso_ia_empresa_em.competencia),
                          public.competencia_de(empresa, hoje));
    atual date := public.competencia_de(empresa, hoje);
    ini date;
    fi date;
    c record;
    media numeric;
    proj int;
    u int;
    v record;
    funcoes jsonb;
    dias jsonb;
begin
    if not (public.servidor_ia() or public.pode_ver_empresa(empresa)) then
        raise exception 'sem permissão para ver o uso de IA desta empresa';
    end if;
    select x.inicio, x.fim into ini, fi from public.ciclo_de(empresa, comp) x;
    select * into c from public.creditos_ia_condicoes(empresa, comp);
    u := public.creditos_ia_usados(empresa, comp);
    select * into v from public.valor_creditos_ia(empresa, u, comp);
    if comp = atual then
        select x.media_7d, x.projecao into media, proj from public.resumo_creditos_ia_em(empresa, hoje) x;
    end if;
    with uso as (
        select x.funcao, count(*) as usos, sum(x.creditos) as creditos from public.ia_creditos_uso x
         where x.empresa_id = uso_ia_empresa_em.empresa and x.competencia = comp
           and (x.situacao = 'confirmado' or (x.situacao = 'reservado' and x.criado_em > now() - interval '15 minutes'))
         group by x.funcao
    ), g as (
        select f.grupo, min(f.ordem) as ordem, max(f.creditos) as por_uso, coalesce(sum(uso.usos), 0) as usos,
               coalesce(sum(uso.creditos), 0) as creditos
          from public.ia_creditos_funcoes f left join uso on uso.funcao = f.funcao
         group by f.grupo
    )
    select coalesce(jsonb_agg(jsonb_build_object('grupo', g.grupo, 'creditos_por_uso', g.por_uso, 'usos', g.usos,
                                                 'creditos', g.creditos) order by g.ordem), '[]')
      into funcoes from g;
    select coalesce(jsonb_agg(jsonb_build_object('dia', d.dia, 'creditos', coalesce(s.creditos, 0)) order by d.dia), '[]')
      into dias
      from (select generate_series(ini, least(fi, greatest(ini, hoje)), interval '1 day')::date as dia) d
      left join (select x.dia, sum(x.creditos) as creditos from public.ia_creditos_uso x
                  where x.empresa_id = uso_ia_empresa_em.empresa and x.competencia = comp
                    and (x.situacao = 'confirmado' or (x.situacao = 'reservado' and x.criado_em > now() - interval '15 minutes'))
                  group by x.dia) s on s.dia = d.dia;
    return jsonb_build_object(
        'competencia', comp, 'inicio', ini, 'fim', fi, 'renova_em', fi + 1, 'hoje', hoje, 'atual', comp = atual,
        'usados', u, 'franquia', c.franquia, 'excedente', greatest(0, u - c.franquia),
        'preco_excedente', c.preco, 'valor_excedente', coalesce(v.valor, 0),
        'media_7d', media, 'projecao', proj,
        'teto', (select l.teto_creditos_ciclo from public.empresa_limites_ia l where l.empresa_id = uso_ia_empresa_em.empresa),
        'por_funcao', funcoes, 'por_dia', dias);
end $$;

create or replace function public.uso_ia_empresa(empresa bigint, competencia date default null) returns jsonb
language sql stable security definer set search_path = public as $$
    select public.uso_ia_empresa_em(uso_ia_empresa.empresa, uso_ia_empresa.competencia,
                                    (now() at time zone 'America/Sao_Paulo')::date)
$$;

-- ================================================================ 7. fatura: franquia incluída + excedente
create or replace function public.linhas_fatura_creditos_ia(empresa bigint, mes date, posicao int)
returns table (ordem int, item text, descricao text, quantidade numeric, preco numeric, valor numeric)
language plpgsql stable security definer set search_path = public as $$
declare
    usados numeric;
    c record;
    v record;
    exc numeric;
begin
    select coalesce(sum(m.quantidade), 0) into usados from public.consumo_mensageria m
     where m.empresa_id = linhas_fatura_creditos_ia.empresa and m.competencia = mes and m.item = 'ia_creditos';
    if usados = 0 then
        return;
    end if;
    select * into c from public.creditos_ia_condicoes(empresa, mes);
    exc := greatest(0, usados - coalesce(c.franquia, 0));
    if coalesce(c.franquia, 0) > 0 then
        return query select posicao, 'ia_creditos_franquia'::text,
                            format('Créditos de IA (franquia de %s, incluída no contrato)', c.franquia),
                            least(usados, c.franquia)::numeric, 0::numeric, 0::numeric;
    end if;
    select * into v from public.valor_creditos_ia(empresa, usados, mes);
    if v.valor is null then
        return query select posicao, 'ia_creditos'::text, 'Créditos de IA excedentes · sem preço cadastrado'::text,
                            exc, 0::numeric, 0::numeric;
        return;
    end if;
    return query select posicao, 'ia_creditos'::text,
                        'Créditos de IA excedentes · ' || replace(to_char(exc, 'FM999,999,999,990'), ',', '.') || ' × '
                            || public.texto_preco_ia(v.preco_medio),
                        exc, v.preco_medio, v.valor;
end $$;

select pg_temp.trocar('public.previa_fatura(bigint,date)',
'    for c in select ci.* from public.cobranca_itens ci where ci.preco_de is null order by ci.ordem, ci.codigo loop
        qtd_extra := 0;',
'    for c in select ci.* from public.cobranca_itens ci where ci.preco_de is null order by ci.ordem, ci.codigo loop
        qtd_extra := 0;
        if c.codigo = ''ia_creditos'' then   -- SQL 78: franquia incluída + excedente
            return query select * from public.linhas_fatura_creditos_ia(empresa, mes, c.ordem);
            continue;
        end if;');
revoke execute on function public.previa_fatura(bigint, date) from public, anon;

-- parte paga dos créditos (excedente ÷ usados): a margem compara a receita do excedente com o custo dessas unidades; o
-- custo da franquia vai na mensalidade e aparece em margem_creditos_ia. Outros itens: 1.
create or replace function public.fracao_paga_ia(empresa bigint, it text, qtd numeric, competencia date) returns numeric
language sql stable security definer set search_path = public as $$
    select case when it <> 'ia_creditos' or coalesce(qtd, 0) <= 0 then 1::numeric
                else greatest(0, qtd - coalesce((select c.franquia from public.creditos_ia_condicoes(empresa, competencia) c), 0))
                     / qtd end
$$;

-- margem da IA: a receita dos créditos já sem a franquia, contra o custo só das unidades pagas
select pg_temp.trocar('public.margem_ia(date)',
'               case when u.regs is not null then u.cst else u.qtd * public.custo_ia_vigente(u.it, dia) end as cst,',
'               (case when u.regs is not null then u.cst else u.qtd * public.custo_ia_vigente(u.it, dia) end)
                   * public.fracao_paga_ia(u.eid, u.it, u.qtd, comp) as cst,   -- SQL 78: custo das unidades pagas');
select pg_temp.trocar('public.margem_ia(date)',
'          from uso u left join lateral public.valor_item(u.eid, u.it, u.qtd, comp) v on true',
'          from uso u left join lateral (select x.* from public.valor_item(u.eid, u.it, u.qtd, comp) x where u.it <> ''ia_creditos''
                                         union all
                                         select y.* from public.valor_creditos_ia(u.eid, u.qtd, comp) y where u.it = ''ia_creditos'') v on true   -- SQL 78');

-- ================================================================ 8. Master: margem dos créditos e limites
drop function if exists public.margem_creditos_ia(date);
create or replace function public.margem_creditos_ia(competencia date)
returns table (empresa_id bigint, empresa text, usados int, franquia int, excedente int, preco_excedente numeric,
               receita numeric, impostos numeric, custo_cliente numeric, custo_sistema numeric, usos_sistema numeric,
               custo_excedente numeric, custo_franquia numeric, mc_excedente numeric, mc_excedente_pct numeric,
               mc numeric, mc_pct numeric, teto int, franquia_propria boolean)
language plpgsql stable security definer set search_path = public as $$
declare
    par public.parametros_margem;
    comp date := date_trunc('month', margem_creditos_ia.competencia)::date;
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob vê a margem da IA';
    end if;
    select * into par from public.parametros_margem pm where pm.id = 1;
    return query
    with emp as (
        select x.empresa_id as eid from public.ia_creditos_uso x where x.competencia = comp
        union select l.empresa_id from public.empresa_limites_ia l
        union select k.empresa_id from public.consumo_ia k where k.competencia = comp and k.item in ('ia_creditos', 'ia_sem_credito')
        union select p.empresa_id from public.precos_empresa p where p.item = 'ia_creditos' and p.franquia is not null
    ), base as (
        select m.eid, (select coalesce(sum(x.creditos), 0) from public.ia_creditos_uso x
                        where x.empresa_id = m.eid and x.competencia = comp and x.situacao = 'confirmado')::int as usados,
               c.franquia, c.preco, c.preco_id,
               (select k.custo from public.consumo_ia k where k.empresa_id = m.eid and k.competencia = comp and k.item = 'ia_creditos') as cc,
               (select k.custo from public.consumo_ia k where k.empresa_id = m.eid and k.competencia = comp and k.item = 'ia_sem_credito') as cs,
               (select k.quantidade from public.consumo_ia k where k.empresa_id = m.eid and k.competencia = comp and k.item = 'ia_sem_credito') as qs
          from emp m cross join lateral public.creditos_ia_condicoes(m.eid, comp) c
    ), calc as (
        select b.*, coalesce((select v.valor from public.valor_creditos_ia(b.eid, b.usados, comp) v), 0) as rec,
               coalesce(b.cc, 0) * case when b.usados > 0 then greatest(0, b.usados - b.franquia)::numeric / b.usados else 0 end as cexc
          from base b
    )
    select k.eid, e.nome, k.usados, k.franquia, greatest(0, k.usados - k.franquia), k.preco, k.rec,
           round(k.rec * par.impostos_pct / 100, 2), round(coalesce(k.cc, 0), 2), round(coalesce(k.cs, 0), 2),
           coalesce(k.qs, 0),
           round(k.cexc, 2), round(coalesce(k.cc, 0) - k.cexc + coalesce(k.cs, 0), 2),
           round(k.rec - k.rec * par.impostos_pct / 100 - k.cexc, 2),
           case when k.rec > 0 then round((k.rec - k.rec * par.impostos_pct / 100 - k.cexc) / k.rec * 100, 1) end,
           round(k.rec - k.rec * par.impostos_pct / 100 - coalesce(k.cc, 0) - coalesce(k.cs, 0), 2),
           case when k.rec > 0 then round((k.rec - k.rec * par.impostos_pct / 100 - coalesce(k.cc, 0) - coalesce(k.cs, 0))
                                          / k.rec * 100, 1) end,
           (select l.teto_creditos_ciclo from public.empresa_limites_ia l where l.empresa_id = k.eid),
           exists (select 1 from public.precos_empresa p where p.empresa_id = k.eid and p.item = 'ia_creditos'
                     and p.franquia is not null)
      from calc k join public.empresas e on e.id = k.eid
     order by k.usados desc, e.nome;
end $$;

-- franquia (nulo = a do item, hoje 100) e teto (nulo = sem teto) da empresa. Só o Master. A franquia vale a partir do
-- ciclo de hoje (e nos preços já gravados para depois); sem preço próprio, grava o preço de tabela com a franquia.
create or replace function public.salvar_limites_creditos_ia(empresa bigint, franquia int default null, teto int default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    comp date;
    desde date;
    tabela numeric;
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob muda a franquia e o teto da IA';
    end if;
    if not exists (select 1 from public.empresas e where e.id = salvar_limites_creditos_ia.empresa) then
        raise exception 'empresa não encontrada';
    end if;
    if salvar_limites_creditos_ia.franquia is not null and salvar_limites_creditos_ia.franquia not between 0 and 100000 then
        raise exception 'franquia inválida (0 a 100.000 créditos)';
    end if;
    if salvar_limites_creditos_ia.teto is not null and salvar_limites_creditos_ia.teto not between 1 and 1000000 then
        raise exception 'teto inválido (1 a 1.000.000 créditos; vazio = sem teto)';
    end if;
    comp := public.competencia_de(salvar_limites_creditos_ia.empresa, (now() at time zone 'America/Sao_Paulo')::date);
    desde := (public.preco_vigente(salvar_limites_creditos_ia.empresa, 'ia_creditos', comp)).vigente_desde;
    if desde is not null then
        update public.precos_empresa p set franquia = salvar_limites_creditos_ia.franquia
         where p.empresa_id = salvar_limites_creditos_ia.empresa and p.item = 'ia_creditos' and p.vigente_desde >= desde;
    elsif salvar_limites_creditos_ia.franquia is not null then
        select i.preco_tabela into tabela from public.cobranca_itens i where i.codigo = 'ia_creditos';
        if tabela is null then
            raise exception 'Créditos de IA sem preço de tabela: cadastre o custo e o preço em Console › Margem › IA';
        end if;
        insert into public.precos_empresa (empresa_id, item, modelo, preco, minimo, vigente_desde, franquia)
        values (salvar_limites_creditos_ia.empresa, 'ia_creditos', 'flat', tabela, 0, comp, salvar_limites_creditos_ia.franquia);
    end if;
    if salvar_limites_creditos_ia.teto is null then
        delete from public.empresa_limites_ia l where l.empresa_id = salvar_limites_creditos_ia.empresa;
    else
        insert into public.empresa_limites_ia as l (empresa_id, teto_creditos_ciclo)
        values (salvar_limites_creditos_ia.empresa, salvar_limites_creditos_ia.teto)
        on conflict (empresa_id) do update set teto_creditos_ciclo = excluded.teto_creditos_ciclo,
                                               atualizado_em = now(), atualizado_por = auth.uid();
    end if;
    return (select to_jsonb(r) from public.resumo_creditos_ia_em(salvar_limites_creditos_ia.empresa,
                                                                 (now() at time zone 'America/Sao_Paulo')::date) r);
end $$;

-- ================================================================ 9. permissões das funções
revoke all on function public.herdar_franquia_preco(), public.creditos_ia_condicoes(bigint, date),
    public.fracao_paga_ia(bigint, text, numeric, date),
    public.valor_creditos_ia(bigint, numeric, date), public.creditos_ia_usados(bigint, date),
    public.reservar_creditos_ia_em(bigint, text, text, text, uuid, date), public.uso_ia_empresa_em(bigint, date, date),
    public.linhas_fatura_creditos_ia(bigint, date, int)
    from public, anon, authenticated;
revoke all on function public.confirmar_creditos_ia(text, bigint, numeric), public.estornar_creditos_ia(text, text),
    public.estornar_creditos_ia_vencidos(), public.registrar_uso_ia(bigint, text, text, bigint, numeric, text, uuid)
    from public, anon, authenticated;
grant execute on function public.confirmar_creditos_ia(text, bigint, numeric), public.estornar_creditos_ia(text, text),
    public.estornar_creditos_ia_vencidos(), public.registrar_uso_ia(bigint, text, text, bigint, numeric, text, uuid)
    to service_role;
revoke all on function public.servidor_ia(), public.resumo_creditos_ia_em(bigint, date),
    public.reservar_creditos_ia(bigint, text, text, text, uuid), public.uso_ia_empresa(bigint, date),
    public.margem_creditos_ia(date), public.salvar_limites_creditos_ia(bigint, int, int)
    from public, anon;
grant execute on function public.servidor_ia(), public.resumo_creditos_ia_em(bigint, date),
    public.reservar_creditos_ia(bigint, text, text, text, uuid), public.uso_ia_empresa(bigint, date)
    to authenticated, service_role;
grant execute on function public.margem_creditos_ia(date), public.salvar_limites_creditos_ia(bigint, int, int)
    to authenticated;
revoke all on public.ia_creditos_ciclo from anon;
revoke insert, update, delete, truncate on public.ia_creditos_ciclo from authenticated;
grant select on public.ia_creditos_ciclo to authenticated, service_role;
