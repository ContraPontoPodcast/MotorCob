# Prompt de ajuste do site: a carteira no centro

Junta, dentro de cada carteira (credor), os arquivos, a esteira (orquestração), a lista do dia
e os resultados. Não precisa de migração: usa as tabelas de credores (`atualizar_producao_2026-10.sql`).
Cole depois do prompt de credores.

---

```text
Reorganize o site MotorCob para que tudo gire em torno da CARTEIRA. No site, chame a tabela
credores de "Carteira" (singular) / "Carteiras" (plural). NÃO crie, altere ou apague tabelas,
views, buckets ou políticas.

## Regra principal
Arquivo, esteira e lista do dia SEMPRE pertencem a uma carteira. Não existe envio nem
orquestração "solta": as páginas Enviar arquivos, Orquestração e Lista do dia passam a ser abas
DENTRO da carteira. As rotas antigas (/enviar, /orquestracao, /lista) abrem um seletor
"Escolha a carteira" e levam para a aba certa da carteira escolhida.

## Menu
Início · Carteiras · Mapa da Esteira · Ações · Personas · Comitê · Avançado (recolhido:
Canais, Empresas, Usuários). O seletor de credor do topo continua só nas páginas que somam
carteiras (Início, Mapa, Ações, Personas, Comitê), com "Todas as carteiras" como padrão.

## Página Carteiras (/carteiras)
Um cartão por carteira ativa (credores.ativo), em grade, com:
- nome e código;
- "Em cobrança": ultima_execucao (do credor).resumo.carteira.em_cobranca (ou "—");
- "Última carga": data/hora do último envio tipo base ou incremental do credor e o status
  (processado ✓ / pendente ⏳ / erro ✕);
- "Esteira": nome da estratégia padrão do credor (credores.estrategia_id) e quantos segmentos
  próprios (clusters com credor_id = credor). Sem estratégia e sem segmentos: aviso âmbar
  "Sem esteira desenhada: segue o playbook MotorCob";
- "Lista de hoje": soma de resumo_fila (credor, data = hoje, reserva = false) e a hora da
  última execução ok de hoje, ou "ainda não gerada";
- pendências em vermelho: envio com erro, ocorrência de ontem não enviada (ações de ontem
  sem retorno em acoes_dia).
Clicar abre a carteira. Botão "+ Nova carteira" (admin e planejamento) abre o assistente.

## Assistente "Nova carteira" (3 passos, em um modal)
1. Nome (código gerado do nome, editável; insert em credores).
2. Esteira: três opções em cartões —
   "Começar do playbook MotorCob" (cria estratégia "Esteira {nome}" com o playbook, como o
   botão do Desenho da Esteira) · "Copiar a esteira de outra carteira" (select; cria uma
   CÓPIA da estratégia, nome "Esteira {nome}") · "Usar uma esteira existente" (select das
   estrategias; compartilhada). Grava credores.estrategia_id.
3. Primeira carga: o mesmo botão "Carga geral" da aba Arquivos (pode pular: "Enviar depois").
Ao concluir, abre a carteira na aba Visão geral.

## Página da carteira (/carteiras/{codigo}) — título com o nome e abas:
### 1. Visão geral
Checklist "Pronto para rodar", cada item com ✓ verde ou ✕ e um botão que leva à aba certa:
- "Carga geral recebida" (existe envio tipo base processado do credor) → Arquivos;
- "Esteira desenhada" (credores.estrategia_id preenchido ou segmento próprio) → Orquestração;
- "Lista de hoje gerada" (execução ok do credor hoje) → Lista do dia;
- "Ocorrência de ontem recebida" (sem aviso de ações sem ocorrência ontem) → Arquivos.
Abaixo: o funil do credor (resumo_estados do credor), "Ações de ontem" (acoes_dia do
credor) e os alertas da última execução do credor (o primeiro pode ser "LAYOUT AUTOMÁTICO
(confira)": mostre num quadro azul "O que o MotorCob entendeu dos seus arquivos", com cada
"campo = coluna" em uma linha).

### 2. Arquivos
Os botões de envio (Carga geral, Carga incremental, Retirada, Acordo, Baixa / pagamento,
Ocorrência, Atualização de contatos) SEM select de credor: credor_id = esta carteira
(o bureau mantém a opção "Todas as carteiras"). Aceita .csv e .xlsx. Abaixo, o cartão de
andamento e a tabela de envios só desta carteira (credor_id = id), com o relatório.

### 3. Orquestração
O editor de segmentos + Desenho da Esteira, só desta carteira: segmentos com credor_id = id
(e os de credor_id vazio com a etiqueta "todas as carteiras", sem editar aqui). "+ Segmento"
grava credor_id = id. O item fixo "Demais clientes" usa credores.estrategia_id desta
carteira; trocar a estratégia ali grava em credores.estrategia_id.
Ao salvar uma estratégia usada também por outra carteira ou segmento de outra carteira,
pergunte: "Esta esteira também vale para: {lista}. Alterar para todas" ou "Criar uma cópia só
para {esta carteira}" (a cópia é um insert em estrategias com nome "{nome} · {carteira}" e
passa a ser usada aqui: credores.estrategia_id ou clusters.estrategia_id do segmento).

### 4. Lista do dia
Os downloads desta carteira: saidas/{slug}/{data}/{codigo}/ids/{canal}.csv e fila_do_dia.csv
(para datas antigas sem a pasta da carteira, saidas/{slug}/{data}/ids/). Seletor de data
(padrão hoje). Título "Lista do dia · {carteira} · {data}".

### 5. Resultados
Ações (acoes_dia), Mapa (link para /mapa?credor={codigo}) e Personas desta carteira.

## Início
Com "Todas as carteiras": no topo, uma faixa com um mini-cartão por carteira (nome, lista de
hoje, pendências) que leva à carteira; depois o funil somado, como hoje.
```
