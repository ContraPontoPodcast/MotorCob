-- SQL 134 · Agente de voz: a trava do modo Real confere o que a VM usa de verdade.
--
-- public.falta_para_voz(empresa, modo) recriada (mesma assinatura e mesmo retorno: texto com as faltas separadas por
-- vírgula, nulo = pronto; quem chama — ligar_voz_real e pedir_voz_real — não muda):
--   1. 'roteiro em uso' (voz_roteiros, que a VM não usa mais: sem fluxo, a Montagem usa o prompt fixo da VM) sai; entra
--      'fluxo do agente em uso' (voz_fluxo_versoes em_uso, a mesma checagem do "Testar agora", SQL 116). Vale para o
--      modo teste e para o real, como valia o roteiro. Quem só tem fluxo passa; quem só tem roteiro não passa mais.
--   2. Para o modo real, mais quatro faltas:
--        'teto contratado maior que zero'              voz_contrato.concorrencia_contratada > 0 (teto global)
--        'robôs contratados pela empresa'              no contrato por minuto vigente, o limite de conversas; senão,
--                                                      os robôs da licença vigente hoje (a mesma demanda da divisão, SQL 128)
--        'limite da empresa na divisão maior que zero' divisao_concorrencia_voz().limite > 0 para a empresa
--        'transferência para humano configurada'       voz_transferencias ativa da empresa (da empresa toda ou de uma
--                                                      carteira)
--      "Transferência testada" NÃO é exigida aqui (o botão de testar a transferência ainda não existe).
-- pedir_voz_real recriada só para o texto do chamado ("Conferido: fluxo em uso, …"); a regra é a mesma.
-- Nenhuma tabela muda; nenhum modo já ligado é desligado (a trava só vale na próxima troca de modo).
-- Depende dos SQL 56, 58, 93 e 128. Pode rodar de novo. Se o SQL 56 rodar de novo, rode este depois.

-- ================================================================ 1. o que falta para um modo
create or replace function public.falta_para_voz(empresa bigint, modo text) returns text
language sql stable security definer set search_path = public as $$
    select nullif(concat_ws(', ',
        case when not exists (select 1 from public.voz_config c where c.empresa_id = empresa and c.provedor <> 'simulador')
             then 'escolher o provedor de voz' end,
        -- SQL 134: o fluxo do agente (o que a VM executa), não o roteiro antigo
        case when not exists (select 1 from public.voz_fluxo_versoes v where v.empresa_id = empresa and v.situacao = 'em_uso')
             then 'fluxo do agente em uso' end,
        case when not exists (select 1 from public.voz_troncos t where t.empresa_id = empresa and t.ativo and t.teste_ok)
             then 'tronco ativo e testado' end,
        case when not exists (select 1 from public.voz_rotas r where r.empresa_id = empresa
                               and (r.vigente_ate is null or r.vigente_ate >= (now() at time zone 'America/Sao_Paulo')::date))
             then 'rota cadastrada' end,
        case when exists (select 1 from public.voz_config c where c.empresa_id = empresa and c.gravar
                           and c.bucket_gravacoes is null)
             then 'bucket de gravações da empresa' end,
        case when modo = 'teste' and not exists (select 1 from public.voz_config c where c.empresa_id = empresa
                                                  and cardinality(c.numeros_teste_hash) > 0)
             then 'números de teste' end,
        case when modo = 'real' and not exists (select 1 from public.voz_config c where c.empresa_id = empresa and c.modo = 'teste')
             then 'passar antes por só números de teste' end,
        case when modo = 'real' and not exists (select 1 from public.voz_chamadas v where v.empresa_id = empresa and v.modo = 'teste')
             then 'ligação de teste feita' end,
        case when modo = 'real' and not exists (select 1 from public.empresa_contatos c where c.empresa_id = empresa and c.recebe_faturas)
             then 'quem recebe as faturas' end,
        -- SQL 134: sem teto, sem robôs ou sem limite na divisão a VM não disca; sem transferência não há saída para humano
        case when modo = 'real' and coalesce((select v.concorrencia_contratada from public.voz_contrato v where v.id), 0) <= 0
             then 'teto contratado maior que zero' end,
        -- a mesma demanda da divisão (SQL 128): no por minuto vale o limite de conversas; senão, os robôs da licença
        case when modo = 'real'
              and coalesce(case when (select x.modelo from public.voz_cobranca_ia x
                                       where x.empresa_id = empresa and x.vigente_desde <= now()
                                       order by x.vigente_desde desc, x.id desc limit 1) = 'por_minuto'
                                then (select x.limite_conversas from public.voz_cobranca_ia x
                                       where x.empresa_id = empresa and x.vigente_desde <= now()
                                       order by x.vigente_desde desc, x.id desc limit 1)
                                else (select l.robos from public.voz_licencas l
                                       where l.empresa_id = empresa and l.vigente_desde <= public.hoje_sp()
                                       order by l.vigente_desde desc, l.id desc limit 1) end, 0) <= 0
             then 'robôs contratados pela empresa' end,
        case when modo = 'real'
              and coalesce((select d.limite from public.divisao_concorrencia_voz() d where d.empresa_id = empresa), 0) <= 0
             then 'limite da empresa na divisão maior que zero' end,
        case when modo = 'real' and not exists (select 1 from public.voz_transferencias t where t.empresa_id = empresa and t.ativo)
             then 'transferência para humano configurada' end
    ), '')
$$;
comment on function public.falta_para_voz(bigint, text) is
    'O que falta para o modo do Agente de voz (texto separado por vírgula; nulo = pronto). Fluxo em uso (não o roteiro); '
    'no real também teto contratado, robôs/limite por minuto, limite na divisão e transferência. SQL 56 e 134.';
revoke all on function public.falta_para_voz(bigint, text) from public, anon, authenticated;

-- ================================================================ 2. o texto do pedido do cliente
create or replace function public.pedir_voz_real(empresa bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    falta text;
    ch bigint;
    pid bigint;
begin
    if public.sou_equipe() or empresa not in (select public.minhas_empresas()) then
        raise exception 'empresa fora do seu acesso';
    end if;
    if not public.pode('editar_canais') then
        raise exception 'só quem edita canais pede as ligações reais';
    end if;
    if exists (select 1 from public.voz_config c where c.empresa_id = empresa and c.modo = 'real') then
        raise exception 'as ligações reais já estão ligadas';
    end if;
    if exists (select 1 from public.pedidos_envio_real r where r.empresa_id = empresa and r.canal = 'agente_voz'
                                                         and r.situacao = 'aberto') then
        raise exception 'já existe um pedido em aberto';
    end if;
    falta := public.falta_para_voz(empresa, 'real');
    if falta is not null then
        raise exception 'antes de pedir: %', falta;
    end if;
    insert into public.chamados (empresa_id, motivo, assunto, prioridade)
    values (empresa, 'integracao', 'Ligar as ligações reais do agente virtual', 'alta') returning id into ch;
    insert into public.chamado_mensagens (chamado_id, tipo, texto)
    values (ch, 'cliente', 'Pedido de ligações reais do agente virtual. Conferido: fluxo em uso, tronco testado, '
                           || 'rota cadastrada, ligação de teste, quem recebe as faturas, robôs contratados, limite na '
                           || 'divisão e transferência para humano.');
    insert into public.pedidos_envio_real (empresa_id, chamado_id, canal) values (empresa, ch, 'agente_voz') returning id into pid;
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
    select 'equipe', empresa, 'atencao', left('Pedido de ligações reais · ' || e.nome, 140),
           'Conferir e ligar o agente de voz.', '/console/implantacao', 'voz_real:' || pid
      from public.empresas e where e.id = empresa;
    return pid;
end $$;
revoke all on function public.pedir_voz_real(bigint) from public, anon;
grant execute on function public.pedir_voz_real(bigint) to authenticated;
