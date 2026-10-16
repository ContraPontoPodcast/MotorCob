# Prompt Horizons — Console 38: Produtos e preços (bloco 2)

Rode depois do SQL 30. Protótipo aprovado: `docs/homologacao/bloco2-produtos-prototipo.html`.

```text
Console MotorCX (motorcob.online/console). NÃO crie, altere ou apague tabelas, views ou políticas.

## Menu
Grupo novo "Mensageria" no Console com dois itens: "Produtos e preços" (este prompt) e "Fornecedores e rotas"
(prompt 39). Use as permissões da própria pessoa (rpc listar_equipe, campo permissoes, como no prompt 30): o grupo
só aparece com editar_produtos ou gerenciar_fornecedores (Master e Administrativo).

## Produtos e preços
Produto = rota vendida. Lista por canal (abas SMS · WhatsApp · RCS · E-mail) com rpc produtos_catalogo():
colunas Produto (nome + código pequeno em cinza), Mínimo, Tabela, Custo previsto, MC no mínimo (%), Rota.
- Rota: selo verde "Completa" ou âmbar "Incompleta" com os itens de `problemas` num balão ao passar o mouse.
- Custo previsto vazio: "—" com a dica "Monte a rota para ver o custo".
- MC no mínimo < 20%: número em âmbar; < 0: vermelho com "abaixo do custo".
- Valores em R$ com 4 casas (ex.: R$ 0,0450). Um (i) ao lado de "MC no mínimo" leva ao termo do glossário.

Botão "Novo produto" (cor da área Mensageria) abre gaveta: Canal (select), Código (prefixo do canal já escrito:
"sms_", só letras minúsculas, números e _), Nome, Unidade (mensagem, envio, sessão), Preço mínimo, Preço de
tabela, Descrição, chave "Padrão do canal" (o produto usado quando a ação não escolhe um).
Salvar: rpc salvar_produto(codigo, canal, nome, unidade, preco_minimo, preco_tabela, descricao, padrao_canal).
Editar: a mesma gaveta (código travado). Regras na tela antes de salvar: tabela ≥ mínimo; mínimo > 0.
Depois de salvar, botão "Montar a rota" leva a Fornecedores e rotas › rota deste produto.

## Contratação (Console › Empresas › empresa › Contratação), seção Mensageria
- Cada produto do canal com chave "Ligado" (tabela empresa_produtos: empresa_id, item, ativo). Produto com rota
  incompleta: chave desabilitada com "Rota incompleta: monte a rota antes". Ligar sem preço: abre o preço antes.
- Preço do produto: campo único com a régua "Mínimo R$ x · Tabela R$ y" embaixo. Salvar:
  rpc salvar_preco(empresa, item, modelo, preco, minimo, faixas, vigente_desde, motivo).
- Comercial negocia entre mínimo e tabela. Abaixo do mínimo: só Master e Administrativo
  (permissão preco_abaixo_minimo); o campo "Motivo (vai para a Auditoria)" aparece e é obrigatório (3+ letras).
  Para os outros, o valor abaixo do mínimo fica vermelho e o Salvar desabilitado com a frase
  "Abaixo do mínimo só com o Administrativo".
- Erro do banco nunca aparece cru: "Não conseguimos salvar o preço. Tente de novo; se repetir, abra um chamado."
  + "Ver detalhe técnico" recolhido.

Confira em 1440 e 390 px, claro e escuro.
```
