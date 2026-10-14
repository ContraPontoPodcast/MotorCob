-- SQL 30 · Produtos da Mensageria, negociação com fornecedores, rota por produto, preço mínimo e perfil Administrativo
-- (bloco 2 da homologação, aprovado em 14/10/2026 — docs/homologacao/bloco2-produtos-prototipo.html).
-- 1. Equipe: perfil Administrativo (papel 'planejamento' na equipe) — ativação, faturamento, NF, produtos e preços,
--    preço abaixo do mínimo e fornecedores. Permissões novas: editar_produtos, preco_abaixo_minimo,
--    gerenciar_fornecedores.
-- 2. Produto = a rota que se vende (cobranca_itens): canal, preço mínimo, preço de tabela, produto padrão do canal.
--    Novos: SMS OTP/Short/Marketing, E-mail sem/com anexo. Os antigos (sms, email, rcs_*, whatsapp_*) continuam.
-- 3. Negociação com o fornecedor (mensageria_custos): flat (operadora vazia) ou por operadora; custo sempre > 0;
--    cada gravação é um conjunto completo com vigência; "encerrada" tira o fornecedor do produto.
-- 4. Rota do produto (mensageria_planos_rota.item): flat (composição) ou por operadora (blocos + "demais"); cada
--    bloco soma 100%; fornecedor sem custo naquele produto/operadora é recusado. Operadora sem bloco e sem "demais"
--    usa o plano do canal.
-- 5. Mistura de operadoras (market share) para o custo previsto; custo_previsto(item).
-- 6. Preço mínimo: abaixo dele só Administrativo/Master, com motivo (fica no preço e na Auditoria).
-- 7. Produtos contratados por empresa (empresa_produtos): só produto com rota completa e preço pode ser ligado.
-- 8. Regra do canal no canal: a carteira (credor) herda a configuração do canal da empresa e pode sobrescrever.
-- 9. Campanha escolhe o produto; comitê por produto (% gasto × % CPC).
-- Rode depois do SQL 29. Pode rodar mais de uma vez.

-- ================================================================ 1. perfil Administrativo
create or replace view public.permissoes_equipe_catalogo as
select * from (values
    ('ver_empresas', 'Empresas', 'Ver empresas e Saúde', true, true, true, true),
    ('criar_empresa', 'Empresas', 'Criar empresa', true, false, true, false),
    ('convidar_admin', 'Empresas', 'Convidar o Admin do cliente', true, false, true, false),
    ('pausar_empresa', 'Empresas', 'Ativar, suspender, encerrar ou reativar empresa', true, false, false, true),
    ('editar_contratacao', 'Contratação', 'Editar contratação', true, false, false, false),
    ('editar_precos', 'Contratação', 'Editar preços (entre o mínimo e a tabela)', true, false, false, true),
    ('ver_faturamento', 'Financeiro', 'Ver faturamento', true, false, true, true),
    ('emitir_faturas', 'Financeiro', 'Ajustar e emitir faturas e notas fiscais', true, false, false, true),
    ('ver_margem', 'Financeiro', 'Ver margem (MC)', true, false, false, true),
    ('responder_chamados', 'Atendimento', 'Responder chamados', true, true, false, false),
    ('acessar_mensageria', 'Atendimento', 'Entrar na Mensageria do cliente', true, true, false, false),
    ('gerenciar_equipe', 'Equipe', 'Gerenciar a equipe', true, false, false, false),
    ('editar_produtos', 'Produtos', 'Criar produtos e definir preço mínimo e de tabela', true, false, false, true),
    ('preco_abaixo_minimo', 'Produtos', 'Dar preço abaixo do mínimo (com motivo)', true, false, false, true),
    ('gerenciar_fornecedores', 'Produtos', 'Fornecedores, negociações e rotas', true, false, false, true)
) as c(permissao, grupo, nome, master, atendimento, comercial, administrativo);
grant select on public.permissoes_equipe_catalogo to authenticated;

create or replace function public.funcao_equipe(papel public.papel) returns text
language sql immutable as $$
    select case papel when 'admin' then 'master' when 'gestao' then 'comercial'
                      when 'planejamento' then 'administrativo' else 'atendimento' end
$$;

create or replace function pg_temp.trocar(assinatura text, de text, para text) returns void
language plpgsql as $$
declare d text := pg_get_functiondef(assinatura::regprocedure);
begin
    if position(para in d) > 0 then
        return;
    end if;
    if position(de in d) = 0 then
        raise exception 'trecho não encontrado em %: %', assinatura, de;
    end if;
    execute replace(d, de, para);
end $$;

select pg_temp.trocar('public.pode_equipe(text)', $a$when 'comercial' then c.comercial
                                                                             else c.atendimento end$a$,
    $b$when 'comercial' then c.comercial when 'administrativo' then c.administrativo
                                                                             else c.atendimento end$b$);
select pg_temp.trocar('public.listar_equipe()', $a$when 'comercial' then c.comercial
                                                                                    else c.atendimento end$a$,
    $b$when 'comercial' then c.comercial when 'administrativo' then c.administrativo
                                                                                    else c.atendimento end$b$);
select pg_temp.trocar('public.definir_funcao_equipe(uuid,text)',
    $a$if funcao not in ('master', 'atendimento', 'comercial') then
        raise exception 'função inválida: use master, atendimento ou comercial';$a$,
    $b$if funcao not in ('master', 'atendimento', 'comercial', 'administrativo') then
        raise exception 'função inválida: use master, atendimento, comercial ou administrativo';$b$);
select pg_temp.trocar('public.definir_funcao_equipe(uuid,text)',
    $a$when 'comercial' then 'gestao' else 'operacao' end::public.papel,$a$,
    $b$when 'comercial' then 'gestao' when 'administrativo' then 'planejamento' else 'operacao' end::public.papel,$b$);
select pg_temp.trocar('public.definir_funcao_equipe(uuid,text)',
    $a$equipe_alcance = case funcao when 'comercial' then 'carteira' when 'master' then 'todas'$a$,
    $b$equipe_alcance = case funcao when 'comercial' then 'carteira' when 'master' then 'todas' when 'administrativo' then 'todas'$b$);

-- quem cuida de produtos e fornecedores (Master ou quem tem a permissão)
create or replace function public.cuida_fornecedores() returns boolean
language sql stable security definer set search_path = public as $$
    select public.admin_equipe() or public.pode_equipe('gerenciar_fornecedores')
$$;
create or replace function public.cuida_produtos() returns boolean
language sql stable security definer set search_path = public as $$
    select public.admin_equipe() or public.pode_equipe('editar_produtos')
$$;
revoke all on function public.cuida_fornecedores(), public.cuida_produtos() from public, anon;
grant execute on function public.cuida_fornecedores(), public.cuida_produtos() to authenticated;

-- O Administrativo (papel planejamento na equipe) não faz Orquestração, cargas, canais nem usuários do
-- cliente: sem isso, pode() e tem_papel() dariam a ele o que o Planejamento do cliente faz.
create or replace function public.pode(perm text) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((
        select case when p.equipe and p.papel = 'admin' then true
                    when p.equipe and p.papel = 'planejamento'
                         and perm in ('enviar_arquivos', 'reenquadrar', 'editar_orquestracao', 'editar_credores',
                                      'editar_canais', 'gerenciar_usuarios', 'gerenciar_permissoes') then false
                    when p.papel = 'admin' and perm in ('gerenciar_usuarios', 'gerenciar_permissoes') then true
                    else coalesce((select pu.permitido from public.permissoes_usuario pu
                                   where pu.usuario_id = p.id and pu.permissao = perm),
                                  (select pp.permitido from public.permissoes_papel pp
                                   where pp.empresa_id = p.empresa_id and pp.papel = p.papel and pp.permissao = perm),
                                  public.permissao_padrao(p.papel, perm)) end
        from public.perfis p where p.id = auth.uid() and p.ativo), false)
$$;
create or replace function public.tem_papel(variadic papeis public.papel[]) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((select p.papel = any (papeis) and not (p.equipe and p.papel = 'planejamento')
                     from public.perfis p where p.id = auth.uid() and p.ativo), false)
$$;

-- ================================================================ 2. produtos (catálogo)
-- canal de um item: pelo prefixo do código (os produtos sempre começam pelo canal)
create or replace function public.canal_do_item(it text) returns text
language sql immutable as $$
    select case when it in ('sms', 'sms_resposta', 'consulta_operadora') or it like 'sms\_%' then 'sms'
                when it like 'rcs%' then 'rcs' when it like 'whatsapp%' then 'whatsapp'
                when it = 'email' or it like 'email\_%' then 'email' else it end
$$;

alter table public.cobranca_itens
    add column if not exists canal         text check (canal is null or canal in ('sms', 'email', 'rcs', 'whatsapp')),
    add column if not exists preco_minimo  numeric(14, 5) check (preco_minimo is null or preco_minimo > 0),
    add column if not exists preco_tabela  numeric(14, 5) check (preco_tabela is null or preco_tabela > 0),
    add column if not exists descricao     text check (descricao is null or length(descricao) <= 120),
    add column if not exists padrao_canal  boolean not null default false;
do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'cobranca_itens_tabela_acima_minimo') then
        alter table public.cobranca_itens add constraint cobranca_itens_tabela_acima_minimo
            check (preco_minimo is null or preco_tabela is null or preco_tabela >= preco_minimo);
    end if;
end $$;
update public.cobranca_itens set canal = public.canal_do_item(codigo)
 where canal is null and modulo = 'mensageria' and preco_de is null
   and public.canal_do_item(codigo) in ('sms', 'email', 'rcs', 'whatsapp');
create unique index if not exists cobranca_itens_um_padrao on public.cobranca_itens (canal) where padrao_canal;
insert into public.cobranca_itens (codigo, produto, nome, unidade, modulo, ordem, canal, descricao) values
    ('sms_otp',          'sms',   'SMS OTP',          'mensagem', 'mensageria', 12, 'sms',   'códigos e confirmação de acordo'),
    ('sms_short',        'sms',   'SMS Short',        'mensagem', 'mensageria', 13, 'sms',   'régua e lembretes'),
    ('sms_marketing',    'sms',   'SMS Marketing',    'mensagem', 'mensageria', 14, 'sms',   'ofertas e campanhas'),
    ('email_sem_anexo',  'email', 'E-mail sem anexo', 'mensagem', 'mensageria', 21, 'email', 'aviso e link de pagamento'),
    ('email_com_anexo',  'email', 'E-mail com anexo', 'mensagem', 'mensageria', 22, 'email', 'boleto ou termo em PDF')
on conflict (codigo) do nothing;
-- produto padrão de cada canal (quem não escolhe produto continua no de sempre)
update public.cobranca_itens set padrao_canal = true
 where codigo in ('sms', 'email', 'rcs_basic', 'whatsapp_utilidade')
   and not exists (select 1 from public.cobranca_itens x where x.padrao_canal and x.canal = cobranca_itens.canal);
comment on column public.cobranca_itens.preco_minimo is 'Piso negociável: abaixo dele só Administrativo/Master, com motivo.';
comment on column public.cobranca_itens.preco_tabela is 'Preço que entra na contratação por padrão.';

drop policy if exists cobranca_itens_gravar on public.cobranca_itens;
create policy cobranca_itens_gravar on public.cobranca_itens for all to authenticated
    using (public.cuida_produtos()) with check (public.cuida_produtos());

-- criar ou editar produto (o código vai para a campanha e não muda depois)
create or replace function public.salvar_produto(codigo text, canal text, nome text, unidade text,
                                                 preco_minimo numeric, preco_tabela numeric,
                                                 descricao text default null, padrao_canal boolean default false)
returns text
language plpgsql security definer set search_path = public as $$
declare existe public.cobranca_itens;
begin
    if not public.cuida_produtos() then
        raise exception 'sem permissão para criar ou editar produtos';
    end if;
    if canal not in ('sms', 'email', 'rcs', 'whatsapp') then
        raise exception 'canal inválido: sms, email, rcs ou whatsapp';
    end if;
    if not (codigo = canal or (codigo like canal || '\_%' and codigo ~ '^[a-z0-9_]{2,40}\Z')) then
        raise exception 'código inválido: comece pelo canal (ex.: %_bet) e use letras minúsculas, números e _', canal;
    end if;
    if preco_minimo is null or preco_tabela is null or preco_minimo <= 0 or preco_tabela < preco_minimo then
        raise exception 'informe o preço mínimo e o de tabela (tabela maior ou igual ao mínimo, ambos acima de zero)';
    end if;
    select * into existe from public.cobranca_itens c where c.codigo = salvar_produto.codigo;
    if existe.codigo is not null and existe.canal is distinct from salvar_produto.canal then
        raise exception 'o canal de um produto não muda; crie outro produto';
    end if;
    if padrao_canal then
        update public.cobranca_itens c set padrao_canal = false where c.canal = salvar_produto.canal and c.padrao_canal
           and c.codigo <> salvar_produto.codigo;
    end if;
    insert into public.cobranca_itens (codigo, produto, nome, unidade, modulo, ordem, canal, preco_minimo, preco_tabela,
                                       descricao, padrao_canal)
    values (codigo, canal, trim(nome), trim(unidade), 'mensageria', 100, canal, preco_minimo, preco_tabela,
            nullif(trim(coalesce(descricao, '')), ''), coalesce(padrao_canal, false))
    on conflict on constraint cobranca_itens_pkey do update
        set nome = excluded.nome, unidade = excluded.unidade, preco_minimo = excluded.preco_minimo,
            preco_tabela = excluded.preco_tabela, descricao = excluded.descricao,
            padrao_canal = excluded.padrao_canal or cobranca_itens.padrao_canal;
    return codigo;
end $$;
revoke all on function public.salvar_produto(text, text, text, text, numeric, numeric, text, boolean) from public, anon;
grant execute on function public.salvar_produto(text, text, text, text, numeric, numeric, text, boolean) to authenticated;

-- ================================================================ 3. negociação com o fornecedor
alter table public.mensageria_fornecedores drop constraint if exists mensageria_fornecedores_canais_check;
drop policy if exists fornecedores_gravar on public.mensageria_fornecedores;
create policy fornecedores_gravar on public.mensageria_fornecedores for all to authenticated
    using (public.cuida_fornecedores()) with check (public.cuida_fornecedores());
do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'mensageria_fornecedores_canais_validos') then
        alter table public.mensageria_fornecedores add constraint mensageria_fornecedores_canais_validos
            check (canais <@ array['sms', 'email', 'rcs', 'whatsapp']::text[]);
    end if;
end $$;

alter table public.mensageria_custos drop constraint if exists mensageria_custos_item_check;
alter table public.mensageria_custos drop constraint if exists mensageria_custos_fornecedor_item_vigente_desde_key;
alter table public.mensageria_custos
    add column if not exists operadora  text check (operadora is null or operadora in ('vivo', 'claro', 'tim', 'outras')),
    add column if not exists encerrada  boolean not null default false,
    add column if not exists criado_por uuid default auth.uid() references auth.users (id);
create unique index if not exists mensageria_custos_unico
    on public.mensageria_custos (fornecedor, item, coalesce(operadora, ''), vigente_desde);
do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'mensageria_custos_maior_que_zero') then
        -- vale para o que for gravado daqui em diante (linhas antigas com zero não travam a migração)
        alter table public.mensageria_custos add constraint mensageria_custos_maior_que_zero
            check (encerrada or custo > 0) not valid;
    end if;
end $$;
comment on column public.mensageria_custos.operadora is 'Vazio = valor flat (qualquer operadora). Preenchido = só nessa operadora.';
comment on column public.mensageria_custos.encerrada is 'Linha que encerra a negociação a partir da vigência.';

create or replace function public.validar_custo() returns trigger
language plpgsql set search_path = public as $$
begin
    if new.item <> 'consulta_operadora'
       and not exists (select 1 from public.cobranca_itens c where c.codigo = new.item) then
        raise exception 'produto desconhecido: %', new.item;
    end if;
    if new.operadora is not null and public.canal_do_item(new.item) <> 'sms' then
        raise exception 'custo por operadora só existe no SMS';
    end if;
    return new;
end $$;
drop trigger if exists validar_custo on public.mensageria_custos;
create trigger validar_custo before insert or update on public.mensageria_custos
    for each row execute function public.validar_custo();

-- custo negociado no dia: vale o conjunto da vigência mais recente; nele, a linha da operadora, senão a flat
create or replace function public.custo_negociado(forn text, it text, dia date, op text default null) returns numeric
language sql stable set search_path = public as $$
    with v as (select max(c.vigente_desde) as d from public.mensageria_custos c
                where c.fornecedor = forn and c.item = it and c.vigente_desde <= dia)
    select case when bool_or(c.encerrada) then null
                else coalesce(max(c.custo) filter (where op is not null and c.operadora = op),
                              max(c.custo) filter (where c.operadora is null)) end
      from public.mensageria_custos c, v
     where c.fornecedor = forn and c.item = it and c.vigente_desde = v.d
$$;
-- o nome antigo continua (margem e simulador): agora devolve o valor flat (ou nulo)
create or replace function public.custo_vigente(forn text, it text, dia date) returns numeric
language sql stable set search_path = public as $$
    select public.custo_negociado(forn, it, dia, null)
$$;

-- grava a negociação inteira de um produto com um fornecedor.
-- modo 'flat': valores = {"flat": 0.031}; modo 'operadora': valores = {"claro": 0.027, "vivo": 0.030}
-- modo 'encerrar': tira o fornecedor do produto a partir da data.
create or replace function public.salvar_negociacao(fornecedor text, item text, modo text, valores jsonb,
                                                    vigente_desde date default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
    dia date := coalesce(vigente_desde, current_date);
    k text;
    v jsonb;
begin
    if not public.cuida_fornecedores() then
        raise exception 'sem permissão para negociar com fornecedores';
    end if;
    if not exists (select 1 from public.mensageria_fornecedores f where f.codigo = salvar_negociacao.fornecedor
                   and public.canal_do_item(salvar_negociacao.item) = any (f.canais)) then
        raise exception 'o fornecedor não atende o canal deste produto (marque o canal no cadastro do fornecedor)';
    end if;
    if dia < current_date then
        raise exception 'negociação vale de hoje em diante (custo antigo não muda)';
    end if;
    if modo not in ('flat', 'operadora', 'encerrar') then
        raise exception 'modo inválido: flat, operadora ou encerrar';
    end if;
    delete from public.mensageria_custos c
     where c.fornecedor = salvar_negociacao.fornecedor and c.item = salvar_negociacao.item and c.vigente_desde = dia;
    if modo = 'encerrar' then
        if exists (select 1 from public.mensageria_plano_fornecedores pf join public.mensageria_planos_rota p
                     on p.id = pf.plano_id
                    where p.item = salvar_negociacao.item and p.ativo and pf.fornecedor = salvar_negociacao.fornecedor) then
            raise exception 'este fornecedor está na rota do produto: tire-o da rota antes';
        end if;
        insert into public.mensageria_custos (fornecedor, item, custo, vigente_desde, encerrada)
        values (salvar_negociacao.fornecedor, salvar_negociacao.item, 0, dia, true);
        return;
    end if;
    if jsonb_typeof(valores) <> 'object' or valores = '{}'::jsonb then
        raise exception 'informe os valores';
    end if;
    for k, v in select * from jsonb_each(valores) loop
        if (modo = 'flat' and k <> 'flat') or (modo = 'operadora' and k not in ('vivo', 'claro', 'tim', 'outras')) then
            raise exception 'chave inválida para o modo %: %', modo, k;
        end if;
        if jsonb_typeof(v) <> 'number' or v::text::numeric <= 0 then
            raise exception 'custo precisa ser maior que zero (%)', k;
        end if;
        insert into public.mensageria_custos (fornecedor, item, operadora, custo, vigente_desde)
        values (salvar_negociacao.fornecedor, salvar_negociacao.item, case when modo = 'flat' then null else k end,
                v::text::numeric, dia);
    end loop;
end $$;
revoke all on function public.salvar_negociacao(text, text, text, jsonb, date) from public, anon;
grant execute on function public.salvar_negociacao(text, text, text, jsonb, date) to authenticated;

-- negociações vigentes (para as telas): uma linha por fornecedor × produto × operadora
create or replace view public.negociacoes_vigentes with (security_invoker = true) as
with ult as (
    select c.fornecedor, c.item, max(c.vigente_desde) as d
      from public.mensageria_custos c where c.vigente_desde <= current_date group by 1, 2)
select c.fornecedor, c.item, case when c.operadora is null then 'flat' else 'operadora' end as modo,
       c.operadora, c.custo, c.vigente_desde
  from public.mensageria_custos c join ult on ult.fornecedor = c.fornecedor and ult.item = c.item and ult.d = c.vigente_desde
 where not c.encerrada;
grant select on public.negociacoes_vigentes to authenticated;

drop policy if exists custos_ver on public.mensageria_custos;
create policy custos_ver on public.mensageria_custos for select to authenticated using (public.cuida_fornecedores());
drop policy if exists custos_gravar on public.mensageria_custos;
revoke insert, update, delete on public.mensageria_custos from authenticated;     -- só por salvar_negociacao

-- ================================================================ 4. rota do produto
alter table public.mensageria_planos_rota
    add column if not exists item  text references public.cobranca_itens (codigo),
    add column if not exists tipo  text not null default 'flat' check (tipo in ('flat', 'operadora'));
update public.mensageria_planos_rota p set tipo = 'operadora'
 where tipo = 'flat' and exists (select 1 from public.mensageria_plano_fornecedores f where f.plano_id = p.id
                                 and f.operadora is not null);
drop index if exists public.mensageria_planos_um_padrao;
create unique index if not exists mensageria_planos_um_padrao on public.mensageria_planos_rota (canal)
    where padrao and item is null;
create unique index if not exists mensageria_planos_um_por_produto on public.mensageria_planos_rota (item)
    where item is not null;
comment on column public.mensageria_planos_rota.item is 'Produto dono da rota (vazio = plano do canal, como antes).';

drop policy if exists planos_rota_ver on public.mensageria_planos_rota;
create policy planos_rota_ver on public.mensageria_planos_rota for select to authenticated using (public.sou_equipe());

-- problemas da rota de um produto (vazio = completa)
create or replace function public.problemas_rota(item_produto text) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
    p public.mensageria_planos_rota;
    g record;
    l record;
    out text[] := '{}';
    marcadas text[];
    fora text[];
    o text;
begin
    select * into p from public.mensageria_planos_rota r where r.item = item_produto and r.ativo;
    if p.id is null then
        -- produto sem rota própria usa o plano padrão do canal (produtos antigos)
        if exists (select 1 from public.mensageria_planos_rota r where r.item is null and r.padrao and r.ativo
                   and r.canal = public.canal_do_item(item_produto))
           and not exists (select 1 from public.cobranca_itens c where c.codigo = item_produto and c.preco_minimo is not null) then
            return out;
        end if;
        return array['sem rota: monte a rota do produto'];
    end if;
    for g in select coalesce(f.operadora, 'demais') as grupo, sum(f.percentual) as soma, count(*) as n
               from public.mensageria_plano_fornecedores f where f.plano_id = p.id group by 1 loop
        if g.soma <> 100 then
            out := out || format('%s: soma %s%% (precisa ser 100%%)', g.grupo, g.soma);
        end if;
    end loop;
    if not exists (select 1 from public.mensageria_plano_fornecedores f where f.plano_id = p.id) then
        out := out || 'nenhum fornecedor na rota'::text;
    end if;
    select coalesce(array_agg(distinct f.operadora), '{}') into marcadas
      from public.mensageria_plano_fornecedores f where f.plano_id = p.id and f.operadora is not null;
    fora := array(select x from unnest(array['vivo', 'claro', 'tim', 'outras']) x where x <> all (marcadas));
    for l in select f.* from public.mensageria_plano_fornecedores f where f.plano_id = p.id loop
        if p.tipo = 'flat' then
            if public.custo_negociado(l.fornecedor, item_produto, current_date, null) is null then
                out := out || format('%s sem custo flat negociado neste produto', l.fornecedor);
            end if;
        elsif l.operadora is not null then
            if public.custo_negociado(l.fornecedor, item_produto, current_date, l.operadora) is null then
                out := out || format('%s sem custo na %s', l.fornecedor, l.operadora);
            end if;
        else
            foreach o in array fora loop
                if public.custo_negociado(l.fornecedor, item_produto, current_date, o) is null then
                    out := out || format('%s sem custo na %s (bloco Demais operadoras)', l.fornecedor, o);
                end if;
            end loop;
        end if;
    end loop;
    return out;
end $$;
create or replace function public.rota_completa(item_produto text) returns boolean
language sql stable security definer set search_path = public as $$
    select cardinality(public.problemas_rota(item_produto)) = 0
$$;
revoke all on function public.problemas_rota(text), public.rota_completa(text) from public, anon;
grant execute on function public.problemas_rota(text), public.rota_completa(text) to authenticated;

-- grava a rota de um produto. tipo 'flat': itens = [{"fornecedor": "zenvia", "percentual": 50}, ...]
-- tipo 'operadora': cada item com "operadora" (vivo, claro, tim, outras) ou sem ela (= Demais operadoras)
create or replace function public.salvar_rota_produto(item_produto text, tipo text, itens jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    pid bigint;
    c text := public.canal_do_item(item_produto);
    nomep text;
    g record;
    i jsonb;
    op text;
begin
    if not public.cuida_fornecedores() then
        raise exception 'sem permissão para montar rotas';
    end if;
    select nome into nomep from public.cobranca_itens where codigo = item_produto and preco_de is null;
    if nomep is null then
        raise exception 'produto desconhecido: %', item_produto;
    end if;
    if tipo not in ('flat', 'operadora') then
        raise exception 'tipo inválido: flat ou operadora';
    end if;
    if tipo = 'operadora' and c <> 'sms' then
        raise exception 'rota por operadora só existe no SMS';
    end if;
    if jsonb_typeof(itens) <> 'array' or jsonb_array_length(itens) = 0 then
        raise exception 'informe pelo menos um fornecedor';
    end if;
    for i in select * from jsonb_array_elements(itens) loop
        op := nullif(i ->> 'operadora', '');
        if tipo = 'flat' and op is not null then
            raise exception 'rota flat não tem operadora';
        end if;
        if op is not null and op not in ('vivo', 'claro', 'tim', 'outras') then
            raise exception 'operadora inválida: %', op;
        end if;
        if coalesce((i ->> 'percentual')::numeric, -1) not between 0 and 100 then
            raise exception 'percentual de 0 a 100';
        end if;
        if tipo = 'flat' and exists (select 1 from public.negociacoes_vigentes n where n.fornecedor = i ->> 'fornecedor'
                                     and n.item = item_produto and n.modo = 'operadora')
           and public.custo_negociado(i ->> 'fornecedor', item_produto, current_date, null) is null then
            raise exception '% foi negociado só por operadora: não entra em rota flat', i ->> 'fornecedor';
        end if;
        if op is not null and public.custo_negociado(i ->> 'fornecedor', item_produto, current_date, op) is null then
            raise exception '% não tem custo negociado na % para este produto', i ->> 'fornecedor', op;
        end if;
        if tipo = 'flat' and public.custo_negociado(i ->> 'fornecedor', item_produto, current_date, null) is null then
            raise exception '% não tem custo negociado neste produto', i ->> 'fornecedor';
        end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(itens) x
                group by coalesce(x ->> 'operadora', ''), x ->> 'fornecedor' having count(*) > 1) then
        raise exception 'fornecedor repetido no mesmo bloco';
    end if;
    for g in select coalesce(nullif(x ->> 'operadora', ''), 'demais') as grupo, sum((x ->> 'percentual')::numeric) as soma
               from jsonb_array_elements(itens) x group by 1 loop
        if g.soma <> 100 then
            raise exception 'a soma de % precisa ser 100 (está em %)', g.grupo, g.soma;
        end if;
    end loop;
    select id into pid from public.mensageria_planos_rota where item = item_produto;
    if pid is null then
        insert into public.mensageria_planos_rota (nome, canal, item, tipo, descricao)
        values ('Rota ' || nomep, c, item_produto, tipo, 'Rota do produto ' || nomep) returning id into pid;
    else
        update public.mensageria_planos_rota set tipo = salvar_rota_produto.tipo, ativo = true, atualizado_em = now()
         where id = pid;
    end if;
    delete from public.mensageria_plano_fornecedores where plano_id = pid;
    insert into public.mensageria_plano_fornecedores (plano_id, operadora, fornecedor, percentual, ordem_reserva)
    select pid, nullif(x ->> 'operadora', ''), x ->> 'fornecedor', (x ->> 'percentual')::numeric,
           coalesce((x ->> 'ordem_reserva')::int, 1)
      from jsonb_array_elements(itens) x;
    return pid;
end $$;
revoke all on function public.salvar_rota_produto(text, text, jsonb) from public, anon;
grant execute on function public.salvar_rota_produto(text, text, jsonb) to authenticated;

-- planos do canal: quem cuida de fornecedores também pode (antes só o Master)
select pg_temp.trocar('public.salvar_plano_rota(bigint,text,text,jsonb,boolean,text)',
    'if not public.admin_equipe() then', 'if not public.cuida_fornecedores() then');
select pg_temp.trocar('public.ativar_plano_rota(bigint,boolean)',
    'if not public.admin_equipe() then', 'if not public.cuida_fornecedores() then');
select pg_temp.trocar('public.definir_rota_empresa(bigint,text,bigint)',
    'if not public.admin_equipe() then', 'if not public.cuida_fornecedores() then');

-- rota de produto: a linha "por operadora" no plano não exige "todas" (usa o plano do canal)
create or replace function public.validar_plano_fornecedor() returns trigger
language plpgsql set search_path = public as $$
declare c text;
begin
    select canal into c from public.mensageria_planos_rota where id = new.plano_id;
    if not exists (select 1 from public.mensageria_fornecedores f where f.codigo = new.fornecedor and c = any (f.canais)) then
        raise exception 'o fornecedor % não está habilitado para o canal %', new.fornecedor, c;
    end if;
    if new.operadora is not null and c <> 'sms' then
        raise exception 'rota por operadora só existe no SMS';
    end if;
    return new;
end $$;

-- ================================================================ 5. mistura de operadoras e custo previsto
create table if not exists public.mensageria_mistura_operadoras (
    operadora      text primary key check (operadora in ('vivo', 'claro', 'tim', 'outras')),
    percentual     numeric(5, 2) not null check (percentual between 0 and 100),
    fonte          text not null default '' check (length(fonte) <= 120),
    atualizado_em  timestamptz not null default now(),
    atualizado_por uuid default auth.uid() references auth.users (id)
);
comment on table public.mensageria_mistura_operadoras is
    'Market share de celulares por operadora (ex.: Teleco/Anatel), usado no custo previsto das rotas por operadora.';
insert into public.mensageria_mistura_operadoras (operadora, percentual, fonte) values
    ('vivo', 37.8, 'Teleco (dados Anatel) · agosto/2026 · celulares'),
    ('claro', 33.0, 'Teleco (dados Anatel) · agosto/2026 · celulares'),
    ('tim', 22.0, 'Teleco (dados Anatel) · agosto/2026 · celulares'),
    ('outras', 7.2, 'Teleco (dados Anatel) · agosto/2026 · celulares')
on conflict (operadora) do nothing;
alter table public.mensageria_mistura_operadoras enable row level security;
drop policy if exists mistura_ver on public.mensageria_mistura_operadoras;
create policy mistura_ver on public.mensageria_mistura_operadoras for select to authenticated
    using (public.cuida_fornecedores() or public.cuida_produtos());
revoke all on public.mensageria_mistura_operadoras from anon;
revoke insert, update, delete on public.mensageria_mistura_operadoras from authenticated;

create or replace function public.salvar_mistura_operadoras(valores jsonb, fonte text) returns void
language plpgsql security definer set search_path = public as $$
declare s numeric;
begin
    if not public.cuida_fornecedores() then
        raise exception 'sem permissão para alterar a mistura de operadoras';
    end if;
    if jsonb_typeof(valores) <> 'object' or (select count(*) from jsonb_object_keys(valores) k
                                              where k in ('vivo', 'claro', 'tim', 'outras')) <> 4 then
        raise exception 'informe vivo, claro, tim e outras';
    end if;
    select sum(v::text::numeric) into s from jsonb_each(valores) e(k, v);
    if abs(s - 100) > 0.05 then
        raise exception 'a soma precisa dar 100%% (está em %)', s;
    end if;
    insert into public.mensageria_mistura_operadoras (operadora, percentual, fonte, atualizado_em, atualizado_por)
    select k, v::text::numeric, coalesce(trim(fonte), ''), now(), auth.uid() from jsonb_each(valores) e(k, v)
    on conflict (operadora) do update set percentual = excluded.percentual, fonte = excluded.fonte,
        atualizado_em = now(), atualizado_por = auth.uid();
end $$;
revoke all on function public.salvar_mistura_operadoras(jsonb, text) from public, anon;
grant execute on function public.salvar_mistura_operadoras(jsonb, text) to authenticated;

-- custo previsto por unidade de um produto (rota completa; senão nulo). Flat: composição. Por operadora: média
-- pela mistura das operadoras atendidas ("demais" = as sem bloco), mais a consulta de operadora mais barata.
create or replace function public.custo_previsto(item_produto text, dia date default current_date) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
    p public.mensageria_planos_rota;
    total numeric := 0;
    peso_total numeric := 0;
    o text;
    peso numeric;
    custo_bloco numeric;
    marcadas text[];
    tem_demais boolean;
    consulta numeric;
begin
    if not public.rota_completa(item_produto) then
        return null;
    end if;
    select * into p from public.mensageria_planos_rota where item = item_produto and ativo;
    if p.id is null then
        return null;
    end if;
    if p.tipo = 'flat' then
        select sum(f.percentual / 100 * public.custo_negociado(f.fornecedor, item_produto, dia, null)) into total
          from public.mensageria_plano_fornecedores f where f.plano_id = p.id;
        return round(total, 5);
    end if;
    select coalesce(array_agg(distinct f.operadora) filter (where f.operadora is not null), '{}'), bool_or(f.operadora is null)
      into marcadas, tem_demais
      from public.mensageria_plano_fornecedores f where f.plano_id = p.id;
    foreach o in array array['vivo', 'claro', 'tim', 'outras'] loop
        if not (o = any (marcadas)) and not coalesce(tem_demais, false) then
            continue;                                 -- vai pelo plano do canal: fora do custo previsto
        end if;
        select m.percentual into peso from public.mensageria_mistura_operadoras m where m.operadora = o;
        select sum(f.percentual / 100 * public.custo_negociado(f.fornecedor, item_produto, dia, o)) into custo_bloco
          from public.mensageria_plano_fornecedores f
         where f.plano_id = p.id and (f.operadora = o or (f.operadora is null and not (o = any (marcadas))));
        total := total + coalesce(peso, 0) * custo_bloco;
        peso_total := peso_total + coalesce(peso, 0);
    end loop;
    select min(public.custo_negociado(f.codigo, 'consulta_operadora', dia, null)) into consulta
      from public.mensageria_fornecedores f where f.consulta_operadora and f.ativo;
    return round(case when peso_total > 0 then total / peso_total else 0 end + coalesce(consulta, 0), 5);
end $$;
revoke all on function public.custo_previsto(text, date) from public, anon;
grant execute on function public.custo_previsto(text, date) to authenticated;

-- catálogo para a tela Produtos e preços (equipe): custo previsto e MC no mínimo
create or replace function public.produtos_catalogo()
returns table (codigo text, canal text, nome text, unidade text, descricao text, padrao_canal boolean,
               preco_minimo numeric, preco_tabela numeric, custo_previsto numeric, mc_no_minimo numeric,
               rota_completa boolean, problemas text[])
language sql stable security definer set search_path = public as $$
    select c.codigo, c.canal, c.nome, c.unidade, c.descricao, c.padrao_canal, c.preco_minimo, c.preco_tabela,
           public.custo_previsto(c.codigo),
           case when c.preco_minimo > 0 and public.custo_previsto(c.codigo) is not null then
               round(((c.preco_minimo * (1 - pm.impostos_pct / 100)) - public.custo_previsto(c.codigo)) / c.preco_minimo * 100, 1)
           end,
           public.rota_completa(c.codigo), public.problemas_rota(c.codigo)
      from public.cobranca_itens c cross join public.parametros_margem pm
     where c.canal is not null and c.preco_de is null and c.ativo and public.sou_equipe()
     order by c.canal, c.ordem, c.codigo
$$;
revoke all on function public.produtos_catalogo() from public, anon;
grant execute on function public.produtos_catalogo() to authenticated;

-- ================================================================ 6. preço mínimo na contratação
alter table public.precos_empresa
    add column if not exists motivo_abaixo text check (motivo_abaixo is null or length(motivo_abaixo) between 3 and 300);
comment on column public.precos_empresa.motivo_abaixo is 'Motivo do preço abaixo do mínimo (Administrativo/Master).';

drop function if exists public.salvar_preco(bigint, text, text, numeric, numeric, jsonb, date);
create or replace function public.salvar_preco(empresa bigint, item text, modelo text, preco numeric default null,
                                               minimo numeric default 0, faixas jsonb default null,
                                               vigente_desde date default null, motivo text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
    mes date := date_trunc('month', coalesce(vigente_desde, current_date))::date;
    pid bigint;
    n int;
    abertas int;
    ordenadas boolean;
    piso numeric;
    menor numeric;
    m text := nullif(trim(coalesce(motivo, '')), '');
begin
    if not public.equipe_pode('editar_precos', salvar_preco.empresa) then
        raise exception 'sem permissão para definir preços desta empresa';
    end if;
    if not exists (select 1 from public.cobranca_itens c where c.codigo = salvar_preco.item and c.preco_de is null) then
        raise exception 'item sem preço próprio ou desconhecido: %', salvar_preco.item;
    end if;
    if salvar_preco.modelo in ('faixa', 'progressivo') then
        if faixas is null or jsonb_typeof(faixas) <> 'array' or jsonb_array_length(faixas) < 2 then
            raise exception 'tabela escalonada precisa de pelo menos duas faixas';
        end if;
        select count(*), count(*) filter (where f ->> 'ate' is null) into n, abertas from jsonb_array_elements(faixas) f;
        if abertas <> 1 then
            raise exception 'a última faixa fica sem limite (acima de) e só ela';
        end if;
        select coalesce(bool_and(a < b), true) into ordenadas from (
            select (f ->> 'ate')::bigint as a, lead((f ->> 'ate')::bigint) over (order by (f ->> 'ate')::bigint) as b
              from jsonb_array_elements(faixas) f where f ->> 'ate' is not null) x where b is not null;
        if not ordenadas or exists (select 1 from jsonb_array_elements(faixas) f
                                    where (f ->> 'ate')::bigint <= 0 or (f ->> 'preco') is null
                                       or (f ->> 'preco')::numeric < 0) then
            raise exception 'faixas inválidas: limites crescentes, maiores que zero, e preço em todas';
        end if;
        select min((f ->> 'preco')::numeric) into menor from jsonb_array_elements(faixas) f;
    elsif salvar_preco.preco is null then
        raise exception 'informe o preço';
    else
        menor := case when salvar_preco.modelo = 'flat' then salvar_preco.preco end;
    end if;
    select c.preco_minimo into piso from public.cobranca_itens c where c.codigo = salvar_preco.item;
    if piso is not null and menor is not null and menor < piso then
        if not (public.admin_equipe() or public.equipe_pode('preco_abaixo_minimo', salvar_preco.empresa)) then
            raise exception 'preço abaixo do mínimo (%): só o Administrativo ou o Master aprovam', piso;
        end if;
        if m is null or length(m) < 3 then
            raise exception 'informe o motivo do preço abaixo do mínimo';
        end if;
    else
        m := null;
    end if;
    delete from public.precos_empresa p where p.empresa_id = empresa and p.item = salvar_preco.item and p.vigente_desde = mes;
    insert into public.precos_empresa (empresa_id, item, modelo, preco, minimo, vigente_desde, motivo_abaixo)
    values (empresa, salvar_preco.item, salvar_preco.modelo,
            case when salvar_preco.modelo in ('flat', 'mensalidade') then salvar_preco.preco end,
            case when salvar_preco.modelo = 'mensalidade' then 0 else coalesce(salvar_preco.minimo, 0) end, mes, m)
    returning id into pid;
    if salvar_preco.modelo in ('faixa', 'progressivo') then
        insert into public.precos_faixas (preco_id, ate, preco)
        select pid, (f ->> 'ate')::bigint, (f ->> 'preco')::numeric from jsonb_array_elements(faixas) f;
    end if;
    return pid;
end $$;
revoke execute on function public.salvar_preco(bigint, text, text, numeric, numeric, jsonb, date, text) from public, anon;
grant execute on function public.salvar_preco(bigint, text, text, numeric, numeric, jsonb, date, text) to authenticated;

-- ================================================================ 7. produtos contratados por empresa
create table if not exists public.empresa_produtos (
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    item            text not null references public.cobranca_itens (codigo),
    ativo           boolean not null default true,
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid default auth.uid() references auth.users (id),
    primary key (empresa_id, item)
);
comment on table public.empresa_produtos is
    'Produtos da Mensageria contratados. Ligado = liberado na campanha e na régua. Empresa sem nenhuma linha = todos.';
insert into public.empresa_produtos (empresa_id, item, ativo)
select distinct p.empresa_id, p.item, true from public.precos_empresa p
  join public.cobranca_itens c on c.codigo = p.item and c.canal is not null
on conflict do nothing;

create or replace function public.validar_empresa_produto() returns trigger
language plpgsql set search_path = public as $$
begin
    if new.ativo and auth.uid() is not null then
        if not exists (select 1 from public.cobranca_itens c where c.codigo = new.item and c.canal is not null and c.ativo) then
            raise exception 'não é um produto da Mensageria: %', new.item;
        end if;
        if not public.rota_completa(new.item) then
            raise exception 'a rota do produto % está incompleta: não pode ser contratado', new.item;
        end if;
        if public.preco_vigente(new.empresa_id, new.item, current_date) is null then
            raise exception 'defina o preço do produto % antes de ligar', new.item;
        end if;
    end if;
    new.atualizado_em := now();
    return new;
end $$;
drop trigger if exists validar_empresa_produto on public.empresa_produtos;
create trigger validar_empresa_produto before insert or update on public.empresa_produtos
    for each row execute function public.validar_empresa_produto();

alter table public.empresa_produtos enable row level security;
drop policy if exists empresa_produtos_ver on public.empresa_produtos;
create policy empresa_produtos_ver on public.empresa_produtos for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists empresa_produtos_gravar on public.empresa_produtos;
create policy empresa_produtos_gravar on public.empresa_produtos for all to authenticated
    using (public.admin_equipe() or public.equipe_pode('editar_contratacao', empresa_id))
    with check (public.admin_equipe() or public.equipe_pode('editar_contratacao', empresa_id));
revoke all on public.empresa_produtos from anon;

-- produtos que a empresa pode usar num canal (campanha e régua): os ligados; empresa sem nenhum = todos do canal
create or replace function public.produtos_liberados(empresa bigint, canal text)
returns table (codigo text, nome text, padrao boolean)
language sql stable security definer set search_path = public as $$
    select c.codigo, c.nome, c.padrao_canal
      from public.cobranca_itens c
     where c.canal = produtos_liberados.canal and c.ativo and c.preco_de is null
       and empresa in (select public.minhas_empresas())
       and (not exists (select 1 from public.empresa_produtos e where e.empresa_id = produtos_liberados.empresa)
            or exists (select 1 from public.empresa_produtos e where e.empresa_id = produtos_liberados.empresa
                       and e.item = c.codigo and e.ativo))
     order by c.padrao_canal desc, c.ordem
$$;
revoke all on function public.produtos_liberados(bigint, text) from public, anon;
grant execute on function public.produtos_liberados(bigint, text) to authenticated;

-- ================================================================ 8. regra do canal: carteira herda e sobrescreve
create table if not exists public.credor_canais (
    empresa_id      bigint not null,
    credor_id       bigint not null,
    canal           text not null check (canal in ('whatsapp', 'rcs', 'agente_voz', 'discador', 'sms', 'email')),
    ajustes         jsonb not null default '{}' check (jsonb_typeof(ajustes) = 'object'),
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid default auth.uid() references auth.users (id),
    primary key (credor_id, canal),
    foreign key (empresa_id, credor_id) references public.credores (empresa_id, id) on delete cascade
);
comment on table public.credor_canais is
    'O que a carteira muda na regra do canal da empresa (canais_empresa). Chave ausente = herdada da empresa.';

-- regra do canal que vale para a carteira: a da empresa com os ajustes da carteira por cima
create or replace view public.canais_credor with (security_invoker = true) as
select cr.empresa_id, cr.id as credor_id, ce.canal,
       coalesce((cc.ajustes ->> 'ativo')::boolean, ce.ativo) as ativo,
       coalesce(cc.ajustes ->> 'janela_inicio', ce.janela_inicio) as janela_inicio,
       coalesce(cc.ajustes ->> 'janela_fim', ce.janela_fim) as janela_fim,
       coalesce((cc.ajustes ->> 'sabado')::boolean, ce.sabado) as sabado,
       coalesce((cc.ajustes ->> 'capacidade_dia')::int, ce.capacidade_dia) as capacidade_dia,
       coalesce((cc.ajustes ->> 'tentativas_dia')::int, ce.tentativas_dia) as tentativas_dia,
       coalesce((cc.ajustes ->> 'respeitar_nao_perturbe')::boolean, ce.respeitar_nao_perturbe) as respeitar_nao_perturbe,
       cc.ajustes ->> 'produto_padrao' as produto_padrao,
       coalesce(array(select jsonb_object_keys(cc.ajustes)), '{}') as sobrescritos
  from public.credores cr
  join public.canais_empresa ce on ce.empresa_id = cr.empresa_id
  left join public.credor_canais cc on cc.credor_id = cr.id and cc.canal = ce.canal;
grant select on public.canais_credor to authenticated;

create or replace function public.validar_credor_canal() returns trigger
language plpgsql set search_path = public as $$
declare k text;
begin
    for k in select jsonb_object_keys(new.ajustes) loop
        if k not in ('ativo', 'janela_inicio', 'janela_fim', 'sabado', 'capacidade_dia', 'tentativas_dia',
                     'respeitar_nao_perturbe', 'produto_padrao') then
            raise exception 'a carteira não pode mudar "%" do canal', k;
        end if;
    end loop;
    if new.ajustes ? 'produto_padrao' and not exists (
        select 1 from public.cobranca_itens c where c.codigo = new.ajustes ->> 'produto_padrao' and c.canal = new.canal) then
        raise exception 'produto padrão não é do canal %', new.canal;
    end if;
    new.atualizado_em := now();
    return new;
end $$;
drop trigger if exists validar_credor_canal on public.credor_canais;
create trigger validar_credor_canal before insert or update on public.credor_canais
    for each row execute function public.validar_credor_canal();

alter table public.credor_canais enable row level security;
drop policy if exists credor_canais_ver on public.credor_canais;
create policy credor_canais_ver on public.credor_canais for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists credor_canais_gravar on public.credor_canais;
create policy credor_canais_gravar on public.credor_canais for all to authenticated
    using (public.tem_papel('admin', 'planejamento') and empresa_id in (select public.minhas_empresas()))
    with check (public.tem_papel('admin', 'planejamento') and empresa_id in (select public.minhas_empresas()));
revoke all on public.credor_canais from anon;

-- ================================================================ 9. campanha escolhe o produto; comitê por produto
alter table public.mensageria_campanhas
    add column if not exists produto text references public.cobranca_itens (codigo);
comment on column public.mensageria_campanhas.produto is 'Produto escolhido (vazio = o padrão do canal; no RCS, pelo tamanho).';

create or replace function public.validar_produto_campanha() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.produto is not null and not exists (
        select 1 from public.cobranca_itens c where c.codigo = new.produto and c.canal = new.canal and c.ativo
           and (not exists (select 1 from public.empresa_produtos e where e.empresa_id = new.empresa_id)
                or exists (select 1 from public.empresa_produtos e where e.empresa_id = new.empresa_id
                           and e.item = c.codigo and e.ativo))) then
        raise exception 'o produto % não está contratado para o canal %', new.produto, new.canal;
    end if;
    return new;
end $$;
drop trigger if exists validar_produto_campanha on public.mensageria_campanhas;
create trigger validar_produto_campanha before insert or update of produto on public.mensageria_campanhas
    for each row execute function public.validar_produto_campanha();

-- comitê: % do gasto × % dos CPCs por produto (CPC = resposta classificada pelo Radar como CPC ou CPC Negócio)
create or replace view public.comite_produtos with (security_invoker = true) as
with envios as (
    select m.empresa_id, date_trunc('month', m.enviado_em)::date as competencia, m.item,
           count(*) filter (where m.situacao not in ('bloqueada', 'pendente')) as disparadas
      from public.mensageria_mensagens m
     where m.item is not null and m.enviado_em is not null
     group by 1, 2, 3),
cpcs as (
    select c.empresa_id, date_trunc('month', c.criada_em)::date as competencia, m.item, count(*) as cpcs
      from public.mensageria_conversas c
      join public.mensageria_mensagens m on m.id = c.mensagem_id
     where c.classe in ('cpc', 'cpc_negocio')
     group by 1, 2, 3)
select e.empresa_id, e.competencia, e.item, ci.nome as produto, ci.canal, e.disparadas,
       round(coalesce((select v.valor from public.valor_item(e.empresa_id, coalesce(ci.preco_de, e.item),
                                                             e.disparadas, e.competencia) v), 0), 2) as gasto,
       coalesce(c.cpcs, 0) as cpcs
  from envios e
  join public.cobranca_itens ci on ci.codigo = e.item
  left join cpcs c on c.empresa_id = e.empresa_id and c.competencia = e.competencia and c.item = e.item
 where e.empresa_id in (select public.minhas_empresas());
grant select on public.comite_produtos to authenticated;

-- ================================================================ auditoria das tabelas novas
do $$
declare t text;
begin
    foreach t in array array['empresa_produtos', 'credor_canais', 'mensageria_mistura_operadoras',
                             'mensageria_custos', 'cobranca_itens'] loop
        execute format('drop trigger if exists auditar on public.%I', t);
        execute format('create trigger auditar after insert or update or delete on public.%I
                        for each row execute function public.auditar()', t);
    end loop;
end $$;
