-- SQL 46 · Permissões que o site pede e o banco não tinha: ver_clientes e ver_painel
-- O menu da Cobrança esconde "Clientes", "Personas" e "Painel" de quem não tem essas permissões, e /painel recusa o
-- acesso. Como elas não existiam no catálogo, ninguém do cliente as tinha. Entram liberadas para os quatro perfis
-- (o Admin pode restringir em Empresa › Pessoas e perfis). Só recria a view do catálogo; pode rodar de novo sem erro.

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
  ('pagar_faturas',        'Administração', 'Pagar faturas e recarregar',   'Pagar faturas (Pix, boleto ou cartão) e pedir recargas do pré-pago.', true, false, false, false, 16),
  ('ver_clientes',         'Operação',      'Ver clientes',                 'Lista e ficha dos clientes da carteira.', true, true, true, true, 17),
  ('ver_painel',           'Gestão',        'Ver o painel',                 'Painel de resultados da área.', true, true, true, true, 18)
) as t (codigo, grupo, nome, descricao, admin, planejamento, operacao, gestao, ordem);
grant select on public.permissoes_catalogo to authenticated;
revoke all on public.permissoes_catalogo from anon;
