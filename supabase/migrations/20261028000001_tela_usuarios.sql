-- Ajustes para a tela Usuários publicada no site:
-- * permissoes_catalogo ganha a coluna "ordem" (o site ordena por ela; sem ela a lista de acessos não carregava).
-- * permissoes_do_papel(papel): acessos que um perfil tem na empresa (padrão MotorCob + ajuste da empresa), para
--   o painel de convite começar igual ao perfil escolhido.
-- * permissoes_do_usuario passa a receber o parâmetro com o nome "uid" (como o site chama).
-- Pode ser rodado de novo sem erro.

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
  ('gerenciar_permissoes', 'Administração', 'Gerenciar permissões',         'Ajustar o que cada perfil pode fazer.', true, false, false, false, 12)
) as t (codigo, grupo, nome, descricao, admin, planejamento, operacao, gestao, ordem);
grant select on public.permissoes_catalogo to authenticated;
revoke all on public.permissoes_catalogo from anon;

create or replace function public.permissoes_do_papel(papel public.papel, empresa bigint default null)
returns table (codigo text, permitido boolean, origem text)
language sql stable security definer set search_path = public as $$
    select c.codigo,
           case when $1 = 'admin' and c.codigo in ('gerenciar_usuarios', 'gerenciar_permissoes') then true
                else coalesce(pp.permitido, public.permissao_padrao($1, c.codigo)) end,
           case when pp.permitido is not null then 'perfil' else 'padrao' end
    from public.permissoes_catalogo c
    left join public.permissoes_papel pp
           on pp.empresa_id = coalesce($2, (select p.empresa_id from public.perfis p where p.id = auth.uid()))
          and pp.papel = $1 and pp.permissao = c.codigo
    where (public.pode('gerenciar_usuarios') or public.pode('gerenciar_permissoes'))
      and ($2 is null or $2 in (select public.minhas_empresas()))
    order by c.ordem
$$;
revoke all on function public.permissoes_do_papel(public.papel, bigint) from public, anon;
grant execute on function public.permissoes_do_papel(public.papel, bigint) to authenticated, service_role;

drop function if exists public.permissoes_do_usuario(uuid);
create function public.permissoes_do_usuario(uid uuid)
returns table (codigo text, permitido boolean, origem text)
language sql stable security definer set search_path = public as $$
    select c.codigo,
           case when p.equipe and p.papel = 'admin' then true
                when p.papel = 'admin' and c.codigo in ('gerenciar_usuarios', 'gerenciar_permissoes') then true
                else coalesce(pu.permitido, pp.permitido, public.permissao_padrao(p.papel, c.codigo)) end,
           case when pu.permitido is not null then 'usuario' when pp.permitido is not null then 'perfil'
                else 'padrao' end
    from public.perfis p
    cross join public.permissoes_catalogo c
    left join public.permissoes_usuario pu on pu.usuario_id = p.id and pu.permissao = c.codigo
    left join public.permissoes_papel pp on pp.empresa_id = p.empresa_id and pp.papel = p.papel and pp.permissao = c.codigo
    where p.id = $1
      and (p.id = auth.uid() or public.admin_equipe()
           or (public.pode('gerenciar_usuarios') and p.empresa_id in (select public.minhas_empresas())))
    order by c.ordem
$$;
revoke all on function public.permissoes_do_usuario(uuid) from public, anon;
grant execute on function public.permissoes_do_usuario(uuid) to authenticated, service_role;
