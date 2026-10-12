-- Conferência geral do banco do MotorCob (só lê; pode rodar quantas vezes quiser).
-- Supabase › SQL Editor › colar › Run. Cada linha diz o que foi conferido, se está OK e o que fazer se não estiver.
-- Funciona mesmo com SQL faltando: cada conferência só consulta a tabela se ela existir.
create or replace function pg_temp.n(q text) returns bigint language plpgsql as $f$
declare r bigint;
begin
    execute q into r;
    return r;
end $f$;

with itens(ordem, item, ok, se_falhar) as (values
  (1,  'SQL 4 · Workspace (contatos, módulos, chamados)',
       to_regclass('public.empresa_contatos') is not null and to_regclass('public.chamados') is not null
       and to_regclass('public.empresa_modulos') is not null,
       'rodar 04_workspace.sql'),
  (2,  'SQL 5 · Faturamento (planos, consumo, faturas)',
       to_regclass('public.planos_empresa') is not null and to_regclass('public.faturas') is not null
       and exists (select 1 from pg_proc where proname = 'previa_fatura'),
       'rodar 05_faturamento.sql'),
  (3,  'SQL 6 · Locaweb no e-mail',
       to_regclass('public.mensageria_fornecedores') is not null
       and pg_temp.n('select count(*) from public.mensageria_fornecedores where codigo = ''locaweb''') > 0,
       'rodar 06_fornecedor_email.sql (depois do 5)'),
  (4,  'SQL 7 · Mensageria (lotes, descadastros)',
       to_regclass('public.mensageria_lotes') is not null and exists (select 1 from pg_proc where proname = 'mudar_lote'),
       'rodar 07_mensageria_envios.sql'),
  (5,  'SQL 8 · Tokens da API',
       to_regclass('public.api_tokens') is not null and exists (select 1 from pg_proc where proname = 'criar_token_api'),
       'rodar 08_api_tokens.sql'),
  (6,  'SQL 9 · Revisão das faturas',
       to_regclass('public.fatura_ajustes') is not null and exists (select 1 from pg_proc where proname = 'emitir_fatura'),
       'rodar 09_faturas_revisao.sql'),
  (7,  'SQL 10 · Equipe (Master e Atendimento)',
       exists (select 1 from pg_proc where proname = 'definir_funcao_equipe'),
       'rodar 10_equipe_master.sql'),
  (8,  'SQL 11 · Saúde do sistema',
       exists (select 1 from pg_proc where proname = 'saude_empresas'),
       'rodar 11_saude_sistema.sql'),
  (17, 'SQL 12 · Preços por produto (flat, faixa, progressiva, mensalidade)',
       to_regclass('public.precos_empresa') is not null and exists (select 1 from pg_proc where proname = 'salvar_preco'),
       'rodar 12_precos_produtos.sql'),
  (18, 'SQL 13 · Rotas por % e operadora, RCS e margem',
       to_regclass('public.mensageria_planos_rota') is not null and exists (select 1 from pg_proc where proname = 'margem_mensageria'),
       'rodar 13_rotas_margem.sql (depois do 12)'),
  (19, 'Canal com mensageria tem plano de rota padrão (precisa para o envio real)',
       to_regclass('public.mensageria_planos_rota') is null
       or pg_temp.n('select count(*) from (select distinct unnest(canais) c from public.empresa_modulos where modulo = ''mensageria'' and ativo) x where x.c in (''sms'', ''email'', ''rcs'') and not exists (select 1 from public.mensageria_planos_rota p where p.canal = x.c and p.padrao and p.ativo)') = 0,
       'Console › Fornecedores › Planos de rota: crie o padrão do canal (ou rode o 13 de novo)'),
  (20, 'SQL 14 · Mensageria por produto (campanhas, templates, centro de custo, listas)',
       to_regclass('public.mensageria_campanhas') is not null and exists (select 1 from pg_proc where proname = 'confirmar_layout'),
       'rodar 14_mensageria_produtos.sql (depois do 13)'),
  (21, 'SQL 15 · Radar, atendimento e links rastreados',
       to_regclass('public.mensageria_conversas') is not null and exists (select 1 from pg_proc where proname = 'registrar_clique'),
       'rodar 15_radar_atendimento_links.sql (depois do 14)'),
  (22, 'SQL 16 · Relatórios (padrão e personalizados)',
       to_regclass('public.relatorios_modelos') is not null and exists (select 1 from pg_proc where proname = 'rodar_relatorio'),
       'rodar 16_relatorios.sql (depois do 15)'),
  (23, 'SQL 17 · Funil com Disparado e o Assistente MotorCob',
       to_regclass('public.mensageria_funil_status') is not null and to_regclass('public.assistente_perguntas') is not null,
       'rodar 17_funil_assistente.sql (depois do 16)'),
  (9,  'Permissões no catálogo (15)',
       pg_temp.n('select count(*) from public.permissoes_catalogo') = 15,
       'rodar os SQL na ordem; o último que mexe no catálogo é o 8'),
  (10, 'Buckets fotos e chamados são privados',
       (select count(*) from storage.buckets where id in ('fotos', 'chamados') and not public) = 2,
       'rodar 04_workspace.sql'),
  (11, 'Tabelas novas com RLS ligada',
       not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
                     and c.relname in ('empresa_contatos', 'empresa_modulos', 'chamados', 'chamado_mensagens',
                                       'planos_empresa', 'tarifas_mensageria', 'faturas', 'fatura_itens',
                                       'fatura_ajustes', 'mensageria_lotes', 'mensageria_mensagens',
                                       'mensageria_descadastros', 'api_tokens', 'api_chamadas')),
       'algum SQL ficou pela metade: rode de novo o da tabela que faltar'),
  (12, 'Anônimo não lê dado de cliente',
       not exists (select 1 from unnest(array['public.chamados', 'public.faturas', 'public.api_tokens']) t
                   where to_regclass(t) is not null and has_table_privilege('anon', t, 'select')),
       'rodar de novo os SQL 4, 5 e 8'),
  (13, 'Pelo menos um Master ativo',
       pg_temp.n('select count(*) from public.perfis where equipe and papel = ''admin'' and ativo') > 0,
       'rodar o SQL "tornar Master" com o seu e-mail'),
  (14, 'Todo Master com duas etapas ligadas',
       not exists (select 1 from public.perfis p where p.equipe and p.papel = 'admin' and p.ativo
                   and not exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status::text = 'verified')),
       'cada Master entra no site e cadastra o autenticador (Minha conta › Segurança)'),
  (15, 'Nenhum autenticador pela metade',
       not exists (select 1 from auth.mfa_factors where status::text = 'unverified' and created_at < now() - interval '1 hour'),
       'apagar os "unverified" antigos (delete from auth.mfa_factors where status = ''unverified'')'),
  (16, 'Mensageria começa em simulação',
       to_regclass('public.mensageria_config') is null
       or pg_temp.n('select count(*) from public.mensageria_config where modo = ''real''') = 0,
       'conferir no Console quem está em envio real (só ligue com o fornecedor integrado)')
)
select ordem, item, case when ok then 'OK' else 'FALTA' end as situacao, case when ok then '' else se_falhar end as o_que_fazer
  from itens order by ordem;
