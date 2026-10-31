-- SQL 54 · Textos "MotorCob" → "MotorCX" no que o cliente lê e vem do banco
-- A marca da plataforma é MotorCX. Três textos gravados pelo banco ainda diziam MotorCob:
-- 1. Aviso do sino quando a equipe revoga um token de API (SQL 41): "Token de API revogado pela MotorCX: <nome>".
-- 2. Aviso do sino quando o Master libera uma empresa inadimplente (SQL 37): "Acesso liberado pela MotorCX até dd/mm".
-- 3. Glossário "O que significa" (SQL 32): os termos cuja definição citava o MotorCob.
-- Só recria as duas funções (o mesmo corpo de antes, mudando só o texto) e troca a palavra nesses termos do
-- glossário. Não muda identificador, schema, slug, domínio (motorcob.online) nem texto legal; os avisos que já
-- foram para o sino ficam como estão. As mensagens de erro das funções da equipe ("só a equipe MotorCob…") não
-- mudam aqui: o site mostra uma frase genérica e elas só aparecem no detalhe técnico.
-- Depende dos SQL 32, 37 e 41. Pode rodar de novo sem erro.

-- ================================================================ 1. token revogado pela equipe (SQL 41)
create or replace function public.revogar_token_api(token_id bigint, motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
    t public.api_tokens;
    m text := nullif(trim(coalesce(motivo, '')), '');
    pela_equipe boolean := public.sou_equipe();
begin
    select * into t from public.api_tokens x where x.id = token_id and x.revogado_em is null;
    if t.id is null or not t.empresa_id in (select public.minhas_empresas()) then
        raise exception 'token não encontrado ou já revogado';
    end if;
    if pela_equipe then
        if not public.admin_equipe() then
            raise exception 'na equipe, só o Master revoga token de cliente';
        end if;
        if m is null or char_length(m) < 5 then
            raise exception 'informe o motivo (incidente de segurança)';
        end if;
    elsif not public.pode('gerenciar_api') then
        raise exception 'sem permissão para revogar token';
    end if;
    update public.api_tokens set revogado_em = now(), revogado_por = auth.uid(), revogado_motivo = left(m, 200)
     where id = t.id;
    if pela_equipe then
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link)
        values ('empresa', t.empresa_id, 'erro', left('Token de API revogado pela MotorCX: ' || t.nome, 140),
                left('Motivo: ' || m || '. O sistema que usava este token parou; crie outro em Integrações.', 400),
                '/empresa/integracoes');
    end if;
end $$;
revoke execute on function public.revogar_token_api(bigint, text) from public, anon;
grant execute on function public.revogar_token_api(bigint, text) to authenticated;

-- ================================================================ 2. inadimplente liberada pelo Master (SQL 37)
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
    values ('empresa', empresa, 'atencao', 'Acesso liberado pela MotorCX até ' || to_char(prazo, 'DD/MM'),
            'A fatura continua em aberto. Pague até ' || to_char(prazo, 'DD/MM') || ' para não bloquear de novo.',
            '/empresa/faturamento'),
           ('equipe', empresa, 'atencao', left('Inadimplente liberada · ' || nome, 140),
            left('Até ' || to_char(prazo, 'DD/MM/YYYY') || '. Motivo: ' || m, 400), '/console/faturas');
    return prazo;
end $$;
revoke all on function public.liberar_inadimplente(bigint, text, date) from public, anon;
grant execute on function public.liberar_inadimplente(bigint, text, date) to authenticated;

-- ================================================================ 3. glossário (SQL 32)
update public.glossario
   set definicao = replace(definicao, 'MotorCob', 'MotorCX'),
       exemplo = replace(exemplo, 'MotorCob', 'MotorCX'),
       antes = replace(antes, 'MotorCob', 'MotorCX'),
       atualizado_em = now()
 where slug in ('cpc-sem-resposta', 'segmento-padrao', 'disparado-enviado-e-entregue', 'modelo-de-mensagem')
   and (definicao like '%MotorCob%' or exemplo like '%MotorCob%' or antes like '%MotorCob%');
