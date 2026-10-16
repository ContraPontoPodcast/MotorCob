-- SQL 37 · Faturas e Contratação (protótipo aprovado em 15/10/2026)
-- 1. Vigência do preço: salvar_preco_vigencia grava a partir do PRÓXIMO ciclo (padrão) ou deste ciclo (exceção,
--    com motivo). O preço continua guardado por mês (dia 1): no ciclo em dias, "próximo ciclo" é o próximo mês.
-- 2. Fatura vencida: lembrete por e-mail no dia seguinte ao vencimento e 5 dias depois; no 7º dia, aviso de que o
--    acesso será bloqueado. Com 10 dias de atraso, a empresa fica INADIMPLENTE (acesso bloqueado, envios parados;
--    Faturamento e Suporte continuam abertos). Pagou: volta sozinha para ativa.
--    O Master pode liberar a empresa inadimplente mesmo com a fatura em aberto, com motivo e prazo (até 30 dias);
--    até o prazo a rotina não bloqueia de novo.
-- 3. Permissão do cliente "pagar_faturas" (Admin por padrão): pagar fatura e pedir recarga. Ver continua com
--    "ver_faturamento".
-- 4. Resumo da emissão em lote, estimativa do ciclo (pós-pago), extrato e duração do saldo (pré-pago).
-- Depende dos SQL 34 (avisos) e 35. Pode rodar de novo sem erro.

-- ================================================================ 1. vigência do preço
alter table public.precos_empresa add column if not exists motivo_vigencia text
    check (motivo_vigencia is null or char_length(trim(motivo_vigencia)) between 5 and 200);
comment on column public.precos_empresa.motivo_vigencia is
    'Preenchido quando o preço entrou no ciclo que já estava correndo (exceção): o porquê.';

-- primeiro dia do mês de faturamento do próximo ciclo
create or replace function public.proximo_ciclo_mes(empresa bigint) returns date
language plpgsql stable security definer set search_path = public as $$
declare
    atual date := public.competencia_de(empresa, current_date);
    prox date;
begin
    prox := date_trunc('month', public.competencia_de(empresa, (public.ciclo_de(empresa, atual)).fim + 1))::date;
    if prox <= date_trunc('month', atual)::date then
        prox := (date_trunc('month', atual) + interval '1 month')::date;
    end if;
    return prox;
end $$;

create or replace function public.salvar_preco_vigencia(empresa bigint, item text, modelo text, preco numeric default null,
    minimo numeric default 0, faixas jsonb default null, vigencia text default 'proximo', motivo text default null,
    motivo_vigencia text default null)
returns table (preco_id bigint, vale_desde date)
language plpgsql security definer set search_path = public as $$
declare d date; pid bigint;
begin
    if vigencia not in ('proximo', 'atual') then
        raise exception 'vigência: próximo ciclo ou este ciclo';
    end if;
    if vigencia = 'atual' and char_length(trim(coalesce(motivo_vigencia, ''))) < 5 then
        raise exception 'para valer neste ciclo, escreva o motivo (o cliente vê a prévia mudar)';
    end if;
    d := case vigencia when 'proximo' then public.proximo_ciclo_mes(empresa)
              else date_trunc('month', public.competencia_de(empresa, current_date))::date end;
    pid := public.salvar_preco(empresa, item, modelo, preco, minimo, faixas, d, motivo);
    update public.precos_empresa p
       set motivo_vigencia = case when salvar_preco_vigencia.vigencia = 'atual' then trim(salvar_preco_vigencia.motivo_vigencia) end
     where p.id = pid;
    return query select pid, d;
end $$;

-- ================================================================ 2. inadimplência e lembretes
do $$
declare c text;
begin
    for c in select conname from pg_constraint
              where conrelid = 'public.empresas'::regclass and contype = 'c'
                and pg_get_constraintdef(oid) like '%situacao%implantacao%' loop
        execute format('alter table public.empresas drop constraint %I', c);
    end loop;
end $$;
alter table public.empresas add constraint empresas_situacao_check
    check (situacao in ('implantacao', 'ativa', 'suspensa', 'encerrada', 'inadimplente'));
comment on column public.empresas.situacao is
    'implantacao, ativa, suspensa (pela equipe), encerrada ou inadimplente (automático: fatura vencida há 10 dias).';

alter table public.empresas
    add column if not exists liberada_ate date,
    add column if not exists liberada_motivo text check (liberada_motivo is null or char_length(liberada_motivo) <= 200);
comment on column public.empresas.liberada_ate is
    'Liberação do Master com fatura em aberto: até esta data a inadimplência não bloqueia de novo.';

-- o sistema (motor ou pagamento) muda a situação sem passar pela permissão de pausar
create or replace function public.carteira_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'INSERT' then
        if public.sou_equipe() and not public.admin_equipe() then
            new.vendedor_id := auth.uid();         -- quem cria fica com a conta
        end if;
        return new;
    end if;
    if auth.uid() is null or public.admin_equipe() or current_setting('motorcob.sistema', true) = '1' then
        return new;
    end if;
    if (new.vendedor_id is distinct from old.vendedor_id or new.gerente_id is distinct from old.gerente_id)
       and not public.pode_equipe('gerenciar_equipe') then
        raise exception 'só quem gerencia a equipe troca o responsável da conta';
    end if;
    if (new.situacao is distinct from old.situacao or new.ativa is distinct from old.ativa)
       and not public.pode_equipe('pausar_empresa') then
        raise exception 'sem permissão para pausar ou reativar a empresa';
    end if;
    if (to_jsonb(new) - 'situacao' - 'ativa' - 'situacao_motivo' - 'situacao_em' - 'situacao_por'
                      - 'vendedor_id' - 'gerente_id' - 'colunas_base')
       is distinct from (to_jsonb(old) - 'situacao' - 'ativa' - 'situacao_motivo' - 'situacao_em' - 'situacao_por'
                         - 'vendedor_id' - 'gerente_id' - 'colunas_base')
       and not public.pode_equipe('editar_contratacao') then
        raise exception 'sem permissão para editar o cadastro da empresa';
    end if;
    return new;
end $$;

create table if not exists public.fatura_lembretes (
    fatura_id   bigint not null references public.faturas (id) on delete cascade,
    tipo        text not null check (tipo in ('d1', 'd5', 'd7')),
    enviado_em  timestamptz not null default now(),
    enviado_para text check (enviado_para is null or char_length(enviado_para) <= 500),
    primary key (fatura_id, tipo)
);
alter table public.fatura_lembretes enable row level security;
revoke all on public.fatura_lembretes from anon, authenticated;
grant select on public.fatura_lembretes to authenticated;
grant all on public.fatura_lembretes to service_role;
drop policy if exists fatura_lembretes_ver on public.fatura_lembretes;
create policy fatura_lembretes_ver on public.fatura_lembretes for select to authenticated
    using (exists (select 1 from public.faturas f where f.id = fatura_id and public.ve_faturamento(f.empresa_id)));

-- lembretes que o motor manda pela função "cobranca" (um por fatura e tipo; só faturas vencidas há até 30 dias)
create or replace function public.lembretes_para_enviar()
returns table (fatura_id bigint, tipo text)
language sql stable security definer set search_path = public as $$
    with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
    select f.id, t.tipo
      from public.faturas f, hoje,
           lateral (values ('d1', 1), ('d5', 5), ('d7', 7)) as t(tipo, dias)
     where f.situacao = 'aberta' and f.vencimento is not null
       and f.vencimento <= hoje.d - t.dias and f.vencimento > hoje.d - 30
       and not exists (select 1 from public.fatura_lembretes l where l.fatura_id = f.id and l.tipo = t.tipo)
       -- só o lembrete mais recente que ainda falta: quem já passou do 7º dia recebe o do 7º, não os três
       and t.dias = (select max(x.dias) from (values (1), (5), (7)) as x(dias) where f.vencimento <= hoje.d - x.dias)
     order by f.id, t.dias
$$;

-- libera a empresa inadimplente que não tem mais fatura vencida há 10 dias
create or replace function public.liberar_se_em_dia(empresa bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare liberou boolean;
begin
    if exists (select 1 from public.faturas f where f.empresa_id = empresa and f.situacao = 'aberta'
                 and f.vencimento <= (now() at time zone 'America/Sao_Paulo')::date - 10) then
        return false;
    end if;
    perform set_config('motorcob.sistema', '1', true);
    update public.empresas set situacao = 'ativa', ativa = true, situacao_motivo = null, situacao_em = now(),
                               situacao_por = null
     where id = empresa and situacao = 'inadimplente';
    liberou := found;
    if liberou then
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link)
        values ('empresa', empresa, 'pronto', 'Acesso liberado', 'O pagamento foi confirmado. Os envios voltam a sair.',
                '/empresa/faturamento');
    end if;
    perform set_config('motorcob.sistema', '', true);
    return liberou;
end $$;

-- motor, uma vez por dia: aviso do 7º dia, bloqueio no 10º e liberação de quem pagou
create or replace function public.atualizar_inadimplencia() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int; e record;
begin
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
    select 'empresa', f.empresa_id, 'atencao', 'O acesso será bloqueado em 3 dias',
           left('A fatura de ' || to_char(f.competencia, 'MM/YYYY') || ' venceu em ' || to_char(f.vencimento, 'DD/MM')
                || '. Pague até ' || to_char(f.vencimento + 9, 'DD/MM') || ' para não bloquear o acesso.', 400),
           '/empresa/faturamento', 'bloqueio_em_3:' || f.id
      from public.faturas f
     where f.situacao = 'aberta' and f.vencimento <= (now() at time zone 'America/Sao_Paulo')::date - 7
       and f.vencimento > (now() at time zone 'America/Sao_Paulo')::date - 10
    on conflict (chave) where chave is not null do nothing;
    get diagnostics k = row_count; n := n + k;

    perform set_config('motorcob.sistema', '1', true);
    for e in
        update public.empresas x
           set situacao = 'inadimplente', ativa = false, situacao_em = now(), situacao_por = null,
               situacao_motivo = left('Fatura vencida há mais de 10 dias (' ||
                   (select to_char(min(f.vencimento), 'DD/MM/YYYY') from public.faturas f where f.empresa_id = x.id
                       and f.situacao = 'aberta' and f.vencimento <= (now() at time zone 'America/Sao_Paulo')::date - 10)
                   || ')', 200)
         where x.situacao = 'ativa'
           and (x.liberada_ate is null or x.liberada_ate < (now() at time zone 'America/Sao_Paulo')::date)
           and exists (select 1 from public.faturas f where f.empresa_id = x.id and f.situacao = 'aberta'
                         and f.vencimento <= (now() at time zone 'America/Sao_Paulo')::date - 10)
        returning x.id, x.nome
    loop
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link)
        values ('empresa', e.id, 'erro', 'Acesso bloqueado por fatura vencida',
                'Os envios estão parados. Pague a fatura em Faturamento para liberar; volta sozinho quando o pagamento confirmar.',
                '/empresa/faturamento'),
               ('equipe', e.id, 'erro', left('Inadimplente · ' || e.nome, 140),
                'Fatura vencida há mais de 10 dias: acesso bloqueado e envios parados.', '/console/faturas');
        n := n + 1;
    end loop;
    perform set_config('motorcob.sistema', '', true);

    for e in select x.id from public.empresas x where x.situacao = 'inadimplente' loop
        if public.liberar_se_em_dia(e.id) then n := n + 1; end if;
    end loop;
    return n;
end $$;

-- pagou: libera na hora (o webhook do pagamento muda a fatura para paga)
create or replace function public.fatura_paga_libera() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.situacao = 'paga' and old.situacao is distinct from 'paga' then
        perform public.liberar_se_em_dia(new.empresa_id);
        if not exists (select 1 from public.faturas f where f.empresa_id = new.empresa_id and f.situacao = 'aberta'
                         and f.vencimento < (now() at time zone 'America/Sao_Paulo')::date) then
            perform set_config('motorcob.sistema', '1', true);
            update public.empresas set liberada_ate = null, liberada_motivo = null
             where id = new.empresa_id and liberada_ate is not null;
            perform set_config('motorcob.sistema', '', true);
        end if;
    end if;
    return new;
end $$;
drop trigger if exists fatura_paga_libera on public.faturas;
create trigger fatura_paga_libera after update of situacao on public.faturas
    for each row execute function public.fatura_paga_libera();

-- Master: libera a empresa inadimplente mesmo com a fatura em aberto, com motivo e prazo (padrão 7 dias, até 30)
create or replace function public.liberar_inadimplente(empresa bigint, motivo text, ate date default null)
returns date
language plpgsql security definer set search_path = public as $$
declare
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    prazo date := coalesce(ate, hoje + 7);
    m text := nullif(trim(coalesce(motivo, '')), '');
    nome text;
begin
    if not public.admin_equipe() then
        raise exception 'só o Master libera empresa inadimplente';
    end if;
    select e.nome into nome from public.empresas e where e.id = empresa and e.situacao = 'inadimplente';
    if nome is null then
        raise exception 'a empresa não está inadimplente';
    end if;
    if m is null or char_length(m) < 5 then
        raise exception 'informe o motivo da liberação';
    end if;
    if prazo < hoje or prazo > hoje + 30 then
        raise exception 'o prazo da liberação vai de hoje até 30 dias';
    end if;
    update public.empresas
       set situacao = 'ativa', ativa = true, liberada_ate = prazo, liberada_motivo = left(m, 200),
           situacao_motivo = left('Liberada pelo Master até ' || to_char(prazo, 'DD/MM/YYYY') || ': ' || m, 200),
           situacao_em = now(), situacao_por = auth.uid()
     where id = empresa;
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link)
    values ('empresa', empresa, 'atencao', 'Acesso liberado pela MotorCob até ' || to_char(prazo, 'DD/MM'),
            'A fatura continua em aberto. Pague até ' || to_char(prazo, 'DD/MM') || ' para não bloquear de novo.',
            '/empresa/faturamento'),
           ('equipe', empresa, 'atencao', left('Inadimplente liberada · ' || nome, 140),
            left('Até ' || to_char(prazo, 'DD/MM/YYYY') || '. Motivo: ' || m, 400), '/console/faturas');
    return prazo;
end $$;

-- reativar inadimplente pela troca de situação comum não vale: é a liberação do Master, com prazo
create or replace function public.mudar_situacao_empresa(empresa bigint, nova text, motivo text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
    atual text;
    m text := nullif(trim(coalesce(motivo, '')), '');
begin
    if not (public.admin_equipe() or public.equipe_pode('pausar_empresa', empresa)) then
        raise exception 'sem permissão para suspender, encerrar ou reativar esta empresa';
    end if;
    if nova not in ('ativa', 'suspensa', 'encerrada') then
        raise exception 'situação inválida: use ativa, suspensa ou encerrada';
    end if;
    select situacao into atual from public.empresas where id = empresa;
    if atual is null then
        raise exception 'empresa não encontrada';
    end if;
    if atual = 'inadimplente' and nova = 'ativa' then
        raise exception 'empresa inadimplente: o Master libera com motivo e prazo (Liberar mesmo com fatura em aberto)';
    end if;
    if nova in ('suspensa', 'encerrada') and (m is null or length(m) < 3) then
        raise exception 'informe o motivo';
    end if;
    update public.empresas
       set situacao = nova, ativa = (nova = 'ativa'), situacao_motivo = m, situacao_em = now(),
           situacao_por = auth.uid()
     where id = empresa;
    return nova;
end $$;
revoke all on function public.mudar_situacao_empresa(bigint, text, text) from public, anon;
grant execute on function public.mudar_situacao_empresa(bigint, text, text) to authenticated;

-- o que o site mostra para a empresa bloqueada
create or replace function public.acesso_da_empresa(empresa bigint)
returns table (situacao text, bloqueada boolean, motivo text, desde timestamptz, liberada_ate date)
language sql stable security definer set search_path = public as $$
    select e.situacao, e.situacao in ('suspensa', 'encerrada', 'inadimplente'), e.situacao_motivo, e.situacao_em,
           e.liberada_ate
      from public.empresas e
     where e.id = empresa and e.id in (select public.minhas_empresas())
$$;

-- ================================================================ 3. permissão de pagar
create or replace view public.permissoes_catalogo as
select * from (values
  -- codigo, grupo, nome, descricao, admin, planejamento, operacao, gestao, ordem
  ('baixar_listas',        'Operação',      'Baixar a lista do dia',        'Arquivos por canal (IDs e contatos) da Lista do dia.', true,  true,  true, true, 1),
  ('baixar_relatorios',    'Operação',      'Baixar arquivos completos',    'Fila completa, higienização, enriquecimento e demais saídas.', true, true, false, false, 2),
  ('baixar_comite',        'Gestão',        'Baixar o relatório de comitê', 'Planilha mensal do comitê.', true, true, false, true, 3),
  ('enviar_arquivos',      'Operação',      'Enviar arquivos',              'Cargas, acordos, pagamentos, ocorrências e retornos dos canais.', true, true, false, false, 4),
  ('reenquadrar',          'Operação',      'Reenquadrar agora',            'Pedir a rodada do motor na hora.', true, true, false, false, 5),
  ('editar_orquestracao',  'Configuração',  'Editar a orquestração',        'Segmentos, estratégias, personas e sugestões.', true, true, false, false, 6),
  ('editar_credores',      'Configuração',  'Editar credores',              'Criar credor, calendário, mapeamento de arquivos e regras de retorno.', true, true, false, false, 7),
  ('editar_canais',        'Configuração',  'Editar canais e frases',       'Canais da empresa (custo, horário) e playbook de frases.', true, true, false, false, 8),
  ('ver_acessos',          'Administração', 'Ver acessos',                  'Histórico de acessos ao site.', true, false, false, true, 9),
  ('ver_auditoria',        'Administração', 'Ver auditoria',                'Quem alterou o quê e quando.', true, false, false, false, 10),
  ('gerenciar_usuarios',   'Administração', 'Gerenciar usuários',           'Convidar, desativar, reativar, resetar senha e trocar perfil.', true, false, false, false, 11),
  ('gerenciar_permissoes', 'Administração', 'Gerenciar permissões',         'Ajustar o que cada perfil pode fazer.', true, false, false, false, 12),
  ('ver_faturamento',      'Administração', 'Ver faturamento',              'Plano, consumo do mês e faturas da empresa.', true, false, false, true, 13),
  ('enviar_mensagens',     'Operação',      'Enviar mensagens',             'Aprovar, pausar, retomar e cancelar lotes da Mensageria; descadastrar contatos.', true, true, false, false, 14),
  ('gerenciar_api',        'Administração', 'Gerenciar tokens de API',      'Criar e revogar os tokens que o sistema da empresa usa na API.', true, false, false, false, 15),
  ('pagar_faturas',        'Administração', 'Pagar faturas e recarregar',   'Pagar faturas (Pix, boleto ou cartão) e pedir recargas do pré-pago.', true, false, false, false, 16)
) as t (codigo, grupo, nome, descricao, admin, planejamento, operacao, gestao, ordem);
grant select on public.permissoes_catalogo to authenticated;
revoke all on public.permissoes_catalogo from anon;

create or replace function public.solicitar_recarga(empresa bigint, valor numeric, forma text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    c public.ciclo_empresa;
    rid bigint;
begin
    if not (public.equipe_pode('emitir_faturas', empresa)
            or (not public.sou_equipe() and empresa in (select public.minhas_empresas()) and public.pode('pagar_faturas'))) then
        raise exception 'só quem pode pagar faturas pede recarga (Admin, por padrão)';
    end if;
    select * into c from public.ciclo_empresa x where x.empresa_id = empresa;
    if c.empresa_id is null or c.modelo_pagamento <> 'pre' then
        raise exception 'a empresa não é pré-paga';
    end if;
    if valor is null or valor < c.recarga_minima then
        raise exception 'a recarga mínima é de R$ %', to_char(c.recarga_minima, 'FM999G999G990D00');
    end if;
    if forma is null or not (forma = any (c.formas)) then
        raise exception 'forma de pagamento não aceita para esta empresa';
    end if;
    insert into public.recargas (empresa_id, valor, forma) values (empresa, round(valor, 2), forma) returning id into rid;
    return rid;
end $$;

-- ================================================================ 4. emissão, estimativa, extrato e saldo
-- o que a confirmação de "Emitir" mostra: quantas, total e para quantos contatos vai o e-mail
create or replace function public.resumo_emissao(faturas bigint[])
returns table (quantidade int, total numeric, contatos int, sem_contato text[])
language plpgsql stable security definer set search_path = public as $$
begin
    if exists (select 1 from public.faturas f where f.id = any (faturas) and not public.equipe_pode('emitir_faturas', f.empresa_id)) then
        raise exception 'sem permissão para emitir estas faturas';
    end if;
    return query
    with fs as (select f.* from public.faturas f where f.id = any (faturas) and f.situacao = 'rascunho'),
    dest as (
        select fs.empresa_id, lower(trim(c.email)) as email
          from fs join public.empresa_contatos c on c.empresa_id = fs.empresa_id
         where c.email is not null and trim(c.email) <> ''
           and (c.recebe_faturas
                or (not exists (select 1 from public.empresa_contatos x where x.empresa_id = fs.empresa_id and x.recebe_faturas)
                    and (c.papel_contrato = 'financeiro'
                         or not exists (select 1 from public.empresa_contatos y where y.empresa_id = fs.empresa_id
                                          and y.papel_contrato = 'financeiro' and y.email is not null)))))
    select (select count(*)::int from fs),
           (select coalesce(sum(fs.valor_total), 0) from fs),
           (select count(distinct (d.empresa_id, d.email))::int from dest d),
           (select coalesce(array_agg(e.nome order by e.nome), '{}') from fs join public.empresas e on e.id = fs.empresa_id
             where not exists (select 1 from dest d where d.empresa_id = fs.empresa_id));
end $$;

-- pós-pago: o ciclo até agora e a estimativa até o fim, no ritmo atual (só a partir do 5º dia)
create or replace function public.estimativa_ciclo(empresa bigint)
returns table (competencia date, inicio date, fim date, dia int, dias int, ate_agora numeric, estimativa numeric)
language plpgsql stable security definer set search_path = public as $$
declare comp date; ini date; fi date; d int; tot int; fixo numeric; var numeric;
begin
    if auth.uid() is not null and not public.ve_faturamento(empresa) then
        raise exception 'sem acesso ao faturamento desta empresa';
    end if;
    comp := public.competencia_de(empresa, current_date);
    select x.inicio, x.fim into ini, fi from public.ciclo_de(empresa, comp) x;
    d := current_date - ini + 1; tot := fi - ini + 1;
    select coalesce(sum(p.valor) filter (where (public.preco_vigente(empresa, p.item, comp)).modelo = 'mensalidade'), 0),
           coalesce(sum(p.valor) filter (where (public.preco_vigente(empresa, p.item, comp)).modelo is distinct from 'mensalidade'
                                           and p.item not like '%\_minimo'), 0)
      into fixo, var
      from public.previa_fatura(empresa, comp) p;
    return query select comp, ini, fi, d, tot,
        (select coalesce(sum(p.valor), 0) from public.previa_fatura(empresa, comp) p),
        case when d >= 5 then round(fixo + var * tot / d, 2) end;
end $$;

-- pré-pago: o que saiu do saldo por dia (envios reais × preço médio do item no ciclo) e as recargas pagas
create or replace function public.extrato_saldo(empresa bigint, de date, ate date)
returns table (dia date, tipo text, descricao text, valor numeric, saldo_depois numeric)
language plpgsql stable security definer set search_path = public as $$
declare atual numeric;
begin
    if auth.uid() is not null and not public.ve_faturamento(empresa) then
        raise exception 'sem acesso ao faturamento desta empresa';
    end if;
    select s.saldo into atual from public.saldo_empresa(empresa) s;
    return query
    with envios as (
        select (m.enviado_em at time zone 'America/Sao_Paulo')::date as d, coalesce(c.produto, l.canal) as item, count(*) as qtd
          from public.mensageria_mensagens m
          join public.mensageria_lotes l on l.id = m.lote_id and l.modo = 'real'
          left join public.mensageria_campanhas c on c.id = l.campanha_id
         where m.empresa_id = empresa and m.enviado_em is not null
           and m.enviado_em >= de - 400 and m.situacao <> 'falhou'
         group by 1, 2),
    precificado as (
        select e.d, e.item, e.qtd,
               e.qtd * coalesce((select v.preco_medio from public.valor_item(empresa, e.item,
                    greatest(coalesce((select sum(cm.quantidade) from public.consumo_mensageria cm
                                        where cm.empresa_id = empresa and cm.item = e.item
                                          and cm.competencia = public.competencia_de(empresa, e.d)), 0), e.qtd),
                    public.competencia_de(empresa, e.d)) v), 0) as valor
          from envios e),
    linhas as (
        select p.d, 'consumo'::text as tipo,
               string_agg(to_char(p.qtd, 'FM999G999G999') || ' ' || p.item, ' · ' order by p.item) as descricao,
               -round(sum(p.valor), 2) as valor
          from precificado p group by p.d
        union all
        select (r.paga_em at time zone 'America/Sao_Paulo')::date, 'recarga',
               'Recarga por ' || case r.forma when 'pix' then 'Pix' when 'boleto' then 'boleto' else 'cartão' end, r.valor
          from public.recargas r where r.empresa_id = empresa and r.situacao = 'paga' and r.paga_em is not null),
    corrido as (
        select l.*, coalesce(atual, 0) - coalesce(sum(l.valor) over (order by l.d desc, l.tipo
                     rows between unbounded preceding and 1 preceding), 0) as depois
          from linhas l)
    select c.d, c.tipo, c.descricao, c.valor, round(c.depois, 2) from corrido c
     where c.d between de and ate order by c.d desc, c.tipo;
end $$;

-- pré-pago: quanto o saldo ainda dura no ritmo dos últimos 7 dias (só com 3 dias de uso ou mais)
create or replace function public.duracao_saldo(empresa bigint)
returns table (saldo numeric, media_dia numeric, dias_com_uso int, dias_restantes int)
language plpgsql stable security definer set search_path = public as $$
declare s numeric; tot numeric; n int;
begin
    if auth.uid() is not null and not public.ve_faturamento(empresa) then
        raise exception 'sem acesso ao faturamento desta empresa';
    end if;
    select x.saldo into s from public.saldo_empresa(empresa) x;
    select coalesce(-sum(x.valor), 0), count(distinct x.dia) into tot, n
      from public.extrato_saldo(empresa, current_date - 7, current_date - 1) x where x.tipo = 'consumo';
    return query select s, round(tot / 7, 2), n,
        case when n >= 3 and tot > 0 and s > 0 then floor(s / (tot / 7))::int end;
end $$;

-- ================================================================ permissões
do $$
declare f text;
begin
    foreach f in array array['public.proximo_ciclo_mes(bigint)',
                             'public.salvar_preco_vigencia(bigint, text, text, numeric, numeric, jsonb, text, text, text)',
                             'public.acesso_da_empresa(bigint)', 'public.resumo_emissao(bigint[])',
                             'public.liberar_inadimplente(bigint, text, date)',
                             'public.estimativa_ciclo(bigint)', 'public.extrato_saldo(bigint, date, date)',
                             'public.duracao_saldo(bigint)'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;
revoke all on function public.lembretes_para_enviar() from public, anon, authenticated;
grant execute on function public.lembretes_para_enviar() to service_role;
revoke all on function public.atualizar_inadimplencia() from public, anon, authenticated;
grant execute on function public.atualizar_inadimplencia() to service_role;
revoke all on function public.liberar_se_em_dia(bigint) from public, anon, authenticated;
