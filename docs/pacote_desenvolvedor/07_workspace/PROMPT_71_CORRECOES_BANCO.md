# Prompt Horizons — 71: correções de nomes do banco (teste de 22/10/2026)

O teste do site em 22/10 encontrou consultas a colunas, tabelas e parâmetros que não existem. Rode depois dos prompts 36 a 70.

```text
Correção pontual: NÃO crie, altere ou apague tabelas, views ou políticas. Só corrija as consultas do site para os
nomes que existem no banco. Não mude textos nem layout além do que está abaixo.

1. Faturas: a tabela faturas NÃO tem "valor" nem "mes". Use valor_total (valor) e competencia (date, o mês da fatura;
   mostre como "set/2026"). Corrija em todas as telas, inclusive no cartão "Faturas em aberto" do Console.
2. Empresas: NÃO existe empresas.situacao_data. Use situacao_em (timestamptz), com situacao_motivo e situacao_por.
3. Primeiros passos: a função é rpc('primeiros_passos', { empresa: <id> }) — o parâmetro se chama "empresa", não
   "empresa_id".
4. Console › Fornecedores e rotas › Rotas: NÃO existe mensageria_rotas_produto. A rota de um produto é:
   from('mensageria_planos_rota').select('id, tipo, item, ativo').eq('item', <codigo do produto>).maybeSingle()
   e as linhas dela: from('mensageria_plano_fornecedores').select('operadora, fornecedor, percentual, ordem_reserva')
   .eq('plano_id', <id>). Sem plano: rota vazia, "Soma: 0%" em âmbar e o problema "Rota sem fornecedor". Nunca mostre
   "Soma: 100%" nem "Nenhum problema" sem fornecedor. Problemas: rpc problemas_rota(item_produto); custo: rpc
   custo_previsto(item_produto); salvar: rpc salvar_rota_produto(item_produto, tipo, itens) (como no prompt 39).
5. Mistura de operadoras: a tabela mensageria_mistura_operadoras tem UMA LINHA POR OPERADORA (colunas operadora,
   percentual, fonte, atualizado_em), não colunas vivo/claro/tim. Leia todas as linhas e preencha cada campo pelo
   valor de "percentual" da linha da operadora ('vivo', 'claro', 'tim', 'outras'); a fonte é a da linha mais recente.
6. Pessoas e perfis: rpc pessoas_empresa({ empresa }) e rpc perfis_empresa({ empresa }) precisam receber o id da
   empresa escolhida no seletor do topo (a equipe não tem empresa própria; com empresa vazia a lista vem vazia).
   Cliente: passe a empresa dele. Sem empresa escolhida (equipe): "Escolha a empresa no topo".
7. Assistente › sugestões: a tabela assistente_sugestoes tem a coluna "ativo" (boolean), não "ativa". Corrija a
   leitura e a gravação no Console › Assistente › Sugestões. Na gaveta, as sugestões vêm de
   rpc('sugestoes_assistente', { tela: location.pathname }) (grupo 'tela' e 'frequentes'); mostre até 5 como botões.
8. Console › Assistente: o teto e a cotação vêm de from('assistente_config').select('teto_mensal_brl, cotacao_dolar,
   cotacao_fonte, cotacao_em, modelo').single(); o custo do mês de rpc assistente_custo_mes(). Cotação vazia: mostre
   "aguardando a cotação do Banco Central (o motor busca uma vez por dia)" e deixe o Master digitar no Editar
   (rpc salvar_assistente_config(teto, cotacao)).

Depois de corrigir, confira no console do navegador que não aparece mais nenhum erro 400/404 do Supabase nessas telas.
```
