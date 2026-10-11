# Prompt Horizons — Correção da página Permissões (erro PGRST205 permissoes_padrao)
Cole no Horizons e publique. Não precisa de SQL: o banco já está certo.

```text
Corrija a página /permissoes. Hoje ela dá erro "Could not find the table 'public.permissoes_padrao'": essa tabela
NÃO existe e não deve ser criada. Reescreva só a carga e a gravação da página; mantenha o visual atual.

DE ONDE VÊM OS DADOS (empresa = a empresa ativa no seletor do topo; para quem não é da equipe MotorCob é
perfis.empresa_id do usuário logado)
1. Catálogo e PADRÃO MOTORCOB POR PERFIL: from('permissoes_catalogo').select('codigo,grupo,nome,descricao,admin,
   planejamento,operacao,gestao,ordem').order('ordem'). O padrão de cada célula é a coluna do perfil:
   padrao(papel, codigo) = linha[papel] (true/false), papel ∈ admin, planejamento, operacao, gestao.
2. Ajustes da empresa: from('permissoes_papel').select('papel,permissao,permitido').eq('empresa_id', empresa).
Remova a consulta a permissoes_padrao.

CÉLULA (permissões nas linhas agrupadas por "grupo", perfis nas colunas Admin, Planejamento, Operação, Gestão)
valor = ajuste da empresa para (papel, codigo) se existir; senão padrao(papel, codigo).
Pontinho laranja #FF9500 quando existe ajuste E ele é diferente do padrão; tooltip "Padrão MotorCob: liberado"
ou "Padrão MotorCob: bloqueado".
Admin × gerenciar_usuarios e Admin × gerenciar_permissoes: sempre ligados, com cadeado, sem clique.

GRAVAR AO CLICAR
novo = !valor. Se novo === padrao(papel, codigo): apagar o ajuste
  from('permissoes_papel').delete().eq('empresa_id', empresa).eq('papel', papel).eq('permissao', codigo)
senão: from('permissoes_papel').upsert({ empresa_id: empresa, papel, permissao: codigo, permitido: novo },
  { onConflict: 'empresa_id,papel,permissao' })
SEMPRE com empresa_id. Atualize a tela de forma otimista e, se der erro, recarregue e mostre a mensagem.

VOLTAR AO PADRÃO MOTORCOB
Confirmação na própria página ("Apagar os ajustes de permissões da {nome da empresa}? Os perfis voltam ao padrão
MotorCob." · Cancelar · Voltar ao padrão). Depois: from('permissoes_papel').delete().eq('empresa_id', empresa).
NUNCA apague sem o filtro de empresa (sem ele, a equipe MotorCob apagaria os ajustes de todas as empresas).

ERROS em português, sem código técnico: permissão negada → "Seu perfil não tem permissão para alterar
permissões." Outros → "Não foi possível salvar. Tente de novo." (o detalhe técnico só no "Copiar detalhe").
Sem empresa ativa (equipe MotorCob sem empresa escolhida): "Escolha uma empresa no topo para ver as permissões."
```
