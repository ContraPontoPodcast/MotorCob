# Prompt Horizons — 47: Console › Filtro de inteligência e contratação do Score (bloco 6)

Rode depois do SQL 33 e do prompt 46.

```text
Console MotorCX. NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Mensageria › Filtro de inteligência (permissão configurar_score: Master e Técnico; outros só leem)
Seletor "Rota": "Padrão (todas as rotas sem configuração própria)" + as rotas de mensageria_planos_rota.
Grava em mensageria_score_config (linha com plano_id da rota; a padrão tem plano_id vazio). Rota sem linha
própria mostra os valores da padrão e o botão "Configurar só esta rota" (insere a linha).
- Modelo: Janela (dias, 7–180), Meia-vida do peso (dias), Peso da falha permanente (1–5), Força da base (0–10).
  Texto: "Probabilidade = (base da operadora × força + entregas ponderadas) ÷ (força + tentativas ponderadas).
  Peso de cada tentativa = ½ elevado a (idade ÷ meia-vida); 'número inexistente' pesa mais."
- Faixas: Alto ≥ (%), Baixo < (%), Histórico mínimo para Baixo, Sem histórico abaixo de. Médio = entre os dois.
- Quarentena (dias até um número Baixo voltar a ser tentado; não pode passar da janela).
- Grupo de controle (% de 0 a 5): "Uma amostra sorteada dos números fora das faixas sai mesmo assim, para
  medir a entrega real. É cobrada como SMS normal."
- Fornecedores que entram na análise: lista de mensageria_fornecedores com chave (mensageria_score_fornecedores
  .considerar; sem linha = entra). Texto: "DLR de fornecedor desmarcado é ignorada no cálculo."
- Nomes devolvidos ao cliente (mensageria_score_nomes: alto, medio, baixo, sem): campo de texto por faixa.
  O banco recusa nomes que imitam status de operadora (Entregue, Delivered, DELIVRD, UNDELIV, DLR…): mostre a
  frase "Esse nome imita status de operadora. Escolha outro." no campo. Toda mudança vai para a Auditoria.
Botão "Salvar filtro da rota" (cor da área).

## 2. Empresas › empresa › Contratação › Score de Entrega (permissão contratar_score)
Chave "Score de Entrega" + forma de cobrança (duas opções): "Por número analisado" (toda a lista) ou
"Só pelos represados". Grava empresa_score (empresa_id, ativo, cobranca 'analisado'|'represado').
Preço: rpc salvar_preco(empresa, 'score_analisado' ou 'score_represado', 'flat', preço, …) com a régua de mínimo
e tabela do item. Texto fixo: "O SMS segue com o preço padrão do contrato; o Score é cobrado à parte."
Em Produtos e preços (prompt 38), seção "Score de Entrega" com mínimo e tabela dos dois itens:
rpc salvar_preco_score(item, preco_minimo, preco_tabela).

Confira em 1440 e 390 px.
```
