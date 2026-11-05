-- SQL 68 · Agente de voz: a equipe MotorCX monta o fluxo do agente virtual para o cliente
-- (o SQL 67 é o 20270103000001_voz_tronco_segredo.sql)
-- Decisão do dono: a equipe MotorCX pode montar os fluxos dentro da empresa cliente. Criar (do zero, de modelo, por
-- texto/pedido), editar o rascunho, duplicar, cuidar da base de respostas e dos casos de teste, testar a conversa
-- (simulador e roleplay) e ENVIAR PARA APROVAÇÃO. Aprovar, colocar em uso, voltar versão e revisar a resposta da base
-- continuam só com o cliente (pode_aprovar_fluxo_voz, aprovar_roteiro_voz na empresa): nada muda neles. A alçada da
-- carteira (salvar_alcada_voz, editar_credores) também continua só com o cliente.
--
-- Critério da equipe: equipe_pode('responder_chamados', empresa), o mesmo que o SQL 58 já usa para a equipe entregar
-- o rascunho do pedido de fluxo feito a ela (entregar_pedido_fluxo_equipe). Ou seja: quem já monta o fluxo do cliente
-- pelo pedido no Suporte passa a montar também direto na tela. Padrão do catálogo: Master, Atendimento e Técnico
-- (o Master tem todas); o Master liga ou desliga por pessoa em Equipe › Permissões. Vale só nas empresas do alcance da
-- pessoa (minhas_empresas: todas ou a carteira). Cliente: igual ao SQL 58 (editar_canais na própria empresa).
--
-- Como: só a checagem muda. pode_editar_fluxo_voz(empresa) é o único teste de "quem edita" das RPCs do fluxo; ele
-- passa a aceitar a equipe pelo critério acima. Valem, sem mudar o corpo de nenhuma delas:
--   SQL 58 · salvar_fluxo_voz, criar_fluxo_de_modelo (chama salvar_fluxo_voz), duplicar_fluxo_voz,
--            salvar_resposta_fluxo_voz, apagar_resposta_fluxo_voz, salvar_caso_teste_fluxo_voz, apagar_caso_teste_fluxo_voz,
--            pedir_fluxo_voz e pedir_fluxo_equipe (por conferir_pedido_fluxo_voz), responder_pedido_fluxo_voz;
--   SQL 59 · salvar_persona_roleplay (persona da empresa), rodar_roleplay_voz, roleplay_para_caso_teste;
--   SQL 66 · enviar_fluxo_voz_aprovacao, cancelar_pedido_fluxo_voz e a política entradas_fluxo_enviar (anexos do pedido).
-- Não usam pode_editar_fluxo_voz e não mudam: aprovar_fluxo_voz, usar_fluxo_voz, voltar_versao_fluxo_voz e
-- revisar_resposta_fluxo_voz (pode_aprovar_fluxo_voz, que continua recusando a equipe), salvar_alcada_voz.
-- Auditoria: as tabelas do fluxo já têm o z_auditar (auditar(): usuario = auth.uid(), a pessoa da equipe). Autor:
-- voz_fluxos.criado_por, voz_fluxo_versoes.criado_por, voz_fluxo_casos_teste.criado_por e roleplay_lotes.pedido_por
-- vêm de auth.uid() por padrão; enviado_por (SQL 66) e cancelado_por também. Nada a mudar para gravar quem da equipe fez.
-- O simulador (Edge Function simular_fluxo_voz) passa a perguntar ao banco pode_editar_fluxo_voz(empresa da versão).
--
-- Nada para anon. Sem superusuário. Pode rodar de novo sem erro. Depende do SQL 20/30 (equipe_pode) e do SQL 58.
-- Se o SQL 58 for rodado de novo, rode este depois (o 58 recria pode_editar_fluxo_voz sem a equipe).
--
-- Conferência (no SQL Editor do Supabase, depois de rodar):
--   select position('responder_chamados' in pg_get_functiondef('public.pode_editar_fluxo_voz(bigint)'::regprocedure)) > 0
--            as equipe_edita,                                                                                   -- true
--          position('sou_equipe' in pg_get_functiondef('public.pode_aprovar_fluxo_voz(bigint)'::regprocedure)) > 0
--            as aprovar_sem_equipe,                                                                             -- true
--          has_function_privilege('anon', 'public.pode_editar_fluxo_voz(bigint)', 'execute') as anon;           -- false

create or replace function public.pode_editar_fluxo_voz(empresa bigint) returns boolean
language sql stable security definer set search_path = public as $$
    -- empresa nula nunca vale (equipe_pode trata eid nulo como "ação sem empresa")
    select case when empresa is null then false
                when public.sou_equipe() then public.equipe_pode('responder_chamados', empresa)
                else empresa in (select public.minhas_empresas()) and public.pode('editar_canais') end
$$;
comment on function public.pode_editar_fluxo_voz(bigint) is
    'Quem monta o fluxo do agente na empresa: cliente com editar_canais; equipe MotorCX com responder_chamados no alcance '
    '(SQL 68). Aprovar e colocar em uso: pode_aprovar_fluxo_voz (só o cliente).';
revoke all on function public.pode_editar_fluxo_voz(bigint) from public, anon;
grant execute on function public.pode_editar_fluxo_voz(bigint) to authenticated;
