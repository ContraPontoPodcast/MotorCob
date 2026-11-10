-- SQL 92 · Preços editáveis: todo preço, franquia e item de cobrança editável pela equipe com permissão.
-- Pedido do dono: "Os preços precisam ser todos editáveis, você pode deixar pré-preenchido." Os itens do treino
-- (SQL 90: ia_treino_voz R$ 1,50/min com franquia de 1.000 min e ia_treino_texto R$ 1,20/sessão com franquia de 300)
-- eram premissas: continuam como padrão (pré-preenchido), editáveis na tabela e por empresa.
--
-- 1. itens_com_franquia(): os itens em que a franquia vale na cobrança: ia_creditos (SQL 78), ia_treino_voz e
--    ia_treino_texto (SQL 90). Franquia só se grava neles.
-- 2. salvar_preco_padrao(item, preco_tabela, preco_minimo): preço de tabela (o que a Contratação pré-preenche) e mínimo
--    dos itens que não são da Mensageria (salvar_produto) nem de IA (salvar_preco_tabela_ia, só o Master): Orquestração,
--    Jornada, Agente de voz (plataforma e gestão de tronco) e Score. Quem edita: editar_produtos (cuida_produtos), como
--    salvar_produto e salvar_preco_score. Mínimo opcional (vazio = sem mínimo); tabela maior ou igual ao mínimo.
-- 3. salvar_franquia_padrao(item, franquia): a franquia padrão (cobranca_itens.franquia_padrao) de um item com franquia,
--    0 a 1.000.000. Só o Master (a franquia da IA é dele, SQL 78). Não mexe na franquia própria de nenhuma empresa.
--    Gatilho guardar_franquia_padrao: pelo site (auth.uid() preenchido), franquia_padrao só muda com o Master, também
--    por gravação direta em cobranca_itens (a policy deixa editar_produtos gravar o catálogo).
-- 4. salvar_preco_franquia(empresa, item, modelo, preco, minimo, faixas, vigencia, motivo, motivo_vigencia, franquia): o
--    mesmo de salvar_preco_vigencia (editar_precos, próximo ciclo ou este ciclo com motivo, mínimo com motivo, guarda da
--    margem da IA) e, nos itens com franquia, a franquia da empresa nessa vigência. Franquia vazia = mantém a que já
--    estava gravada nessa vigência, senão a da vigência anterior (herdar_franquia_preco), senão a padrão do item.
--    ia_creditos: a franquia da empresa continua só com o Master (como salvar_limites_creditos_ia).
-- Não muda preço, franquia nem fatura de ninguém: só acrescenta funções e um gatilho. Não recria nem edita função que
-- já existe. Depende dos SQL 30 (produtos), 37 (vigência), 61 (margem da IA), 78 (franquia) e 90 (treino).
-- Pode rodar de novo.

-- ================================================================ 1. itens com franquia
create or replace function public.itens_com_franquia() returns text[]
language sql immutable parallel safe set search_path = '' as $$
    select array['ia_creditos', 'ia_treino_voz', 'ia_treino_texto']::text[]
$$;
comment on function public.itens_com_franquia() is
    'Itens em que a franquia (cobranca_itens.franquia_padrao, precos_empresa.franquia) vale na cobrança. SQL 92.';

-- ================================================================ 2. tabela e mínimo dos itens fora da Mensageria e da IA
create or replace function public.salvar_preco_padrao(item text, preco_tabela numeric, preco_minimo numeric default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
    i public.cobranca_itens;
begin
    if not public.cuida_produtos() then
        raise exception 'sem permissão para definir o preço de tabela';
    end if;
    select * into i from public.cobranca_itens c where c.codigo = salvar_preco_padrao.item;
    if i.codigo is null or i.preco_de is not null then
        raise exception 'item sem preço próprio ou desconhecido: %', salvar_preco_padrao.item;
    end if;
    if i.canal is not null then
        raise exception 'produto da Mensageria: o preço fica em Console › Produtos (salvar_produto)';
    end if;
    if i.eh_ia then
        raise exception 'item de IA: o preço de tabela fica com o Master em Console › Margem › IA';
    end if;
    if coalesce(salvar_preco_padrao.preco_tabela, 0) <= 0 then
        raise exception 'informe o preço de tabela (maior que zero)';
    end if;
    if salvar_preco_padrao.preco_minimo is not null
       and (salvar_preco_padrao.preco_minimo <= 0 or salvar_preco_padrao.preco_minimo > salvar_preco_padrao.preco_tabela) then
        raise exception 'o mínimo fica entre zero e o preço de tabela (vazio = sem mínimo)';
    end if;
    update public.cobranca_itens c
       set preco_minimo = salvar_preco_padrao.preco_minimo, preco_tabela = salvar_preco_padrao.preco_tabela
     where c.codigo = i.codigo;
end $$;

-- ================================================================ 3. franquia padrão (Master)
create or replace function public.salvar_franquia_padrao(item text, franquia int) returns int
language plpgsql security definer set search_path = public as $$
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob muda a franquia padrão';
    end if;
    if not (salvar_franquia_padrao.item = any (public.itens_com_franquia())) then
        raise exception 'o item % não tem franquia', salvar_franquia_padrao.item;
    end if;
    if salvar_franquia_padrao.franquia is null or salvar_franquia_padrao.franquia not between 0 and 1000000 then
        raise exception 'franquia inválida (0 a 1.000.000)';
    end if;
    update public.cobranca_itens c set franquia_padrao = salvar_franquia_padrao.franquia
     where c.codigo = salvar_franquia_padrao.item;
    return salvar_franquia_padrao.franquia;
end $$;

create or replace function public.guardar_franquia_padrao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.franquia_padrao is distinct from old.franquia_padrao and auth.uid() is not null
       and not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob muda a franquia padrão';
    end if;
    return new;
end $$;
drop trigger if exists guardar_franquia_padrao on public.cobranca_itens;
create trigger guardar_franquia_padrao before update of franquia_padrao on public.cobranca_itens
    for each row execute function public.guardar_franquia_padrao();

-- ================================================================ 4. preço da empresa com a franquia
create or replace function public.salvar_preco_franquia(empresa bigint, item text, modelo text, preco numeric default null,
    minimo numeric default 0, faixas jsonb default null, vigencia text default 'proximo', motivo text default null,
    motivo_vigencia text default null, franquia int default null)
returns table (preco_id bigint, vale_desde date, franquia_vigente int)
language plpgsql security definer set search_path = public as $$
declare
    tem_franquia boolean := salvar_preco_franquia.item = any (public.itens_com_franquia());
    d date;
    anterior int;
    r record;
begin
    if salvar_preco_franquia.franquia is not null then
        if not tem_franquia then
            raise exception 'o item % não tem franquia', salvar_preco_franquia.item;
        end if;
        if salvar_preco_franquia.franquia not between 0 and 1000000 then
            raise exception 'franquia inválida (0 a 1.000.000)';
        end if;
        if salvar_preco_franquia.item = 'ia_creditos' and not public.admin_equipe() then
            raise exception 'só um Master da equipe MotorCob muda a franquia dos Créditos de IA';
        end if;
    end if;
    -- a franquia já gravada na mesma vigência (salvar_preco apaga e grava a linha do mês)
    if tem_franquia and salvar_preco_franquia.vigencia in ('proximo', 'atual') then
        d := case salvar_preco_franquia.vigencia when 'proximo' then public.proximo_ciclo_mes(salvar_preco_franquia.empresa)
                  else date_trunc('month', public.competencia_de(salvar_preco_franquia.empresa, current_date))::date end;
        select p.franquia into anterior from public.precos_empresa p
         where p.empresa_id = salvar_preco_franquia.empresa and p.item = salvar_preco_franquia.item and p.vigente_desde = d;
    end if;
    select * into r from public.salvar_preco_vigencia(salvar_preco_franquia.empresa, salvar_preco_franquia.item,
        salvar_preco_franquia.modelo, salvar_preco_franquia.preco, salvar_preco_franquia.minimo,
        salvar_preco_franquia.faixas, salvar_preco_franquia.vigencia, salvar_preco_franquia.motivo,
        salvar_preco_franquia.motivo_vigencia) v;
    if tem_franquia and coalesce(salvar_preco_franquia.franquia, anterior) is not null then
        update public.precos_empresa p set franquia = coalesce(salvar_preco_franquia.franquia, anterior)
         where p.id = r.preco_id;
    end if;
    return query
    select r.preco_id, r.vale_desde,
           case when tem_franquia then coalesce((select p.franquia from public.precos_empresa p where p.id = r.preco_id),
                                                (select i.franquia_padrao from public.cobranca_itens i
                                                  where i.codigo = salvar_preco_franquia.item)) end;
end $$;

-- ================================================================ 5. permissões das funções
revoke all on function public.guardar_franquia_padrao() from public, anon, authenticated;
revoke all on function public.salvar_preco_padrao(text, numeric, numeric), public.salvar_franquia_padrao(text, int),
    public.salvar_preco_franquia(bigint, text, text, numeric, numeric, jsonb, text, text, text, int) from public, anon;
grant execute on function public.itens_com_franquia() to authenticated, service_role;
grant execute on function public.salvar_preco_padrao(text, numeric, numeric), public.salvar_franquia_padrao(text, int),
    public.salvar_preco_franquia(bigint, text, text, numeric, numeric, jsonb, text, text, text, int) to authenticated;
