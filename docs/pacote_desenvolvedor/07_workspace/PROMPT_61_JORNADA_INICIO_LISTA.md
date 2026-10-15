# Prompt Horizons — 61: Jornada · Início com o mapa e Lista do dia sem códigos (substitui as seções 2 e 3 do prompt 24)

Rode depois do SQL 40 e do prompt 49. Protótipo aprovado em 15/10/2026: `docs/homologacao/jornada-prototipo.html`
(telas "Início: mapa da jornada" e "Lista do dia"). Área da Jornada em verde musgo (tokens area.jornada).

```text
Plataforma do cliente, produto Jornada (MotorCli). NÃO crie, altere ou apague tabelas, views ou políticas. Carteira =
a do seletor no topo. Nada de telefone, e-mail ou CPF na tela: só o ID do cliente.

## 1. Início (/jornada): o mapa
Cabeçalho "Jornada · Carteira {nome}" e "Hoje, {data} · última rodada às {hora}" (execucoes). Período do resultado:
7 · 30 · 90 dias (padrão 30), sempre comparado com o período anterior do mesmo tamanho.
- Cartões na ordem da relação: rpc mapa_jornada(credor, de, ate) e de novo no período anterior → momento, nome, ordem,
  no_momento, com_acao, sucesso, nao, taxa, cobranca. Cada cartão: nome; no_momento grande; "{com_acao} com ação
  hoje"; abaixo, a frase do resultado e a taxa com a variação em pontos (verde se subiu, vermelho se caiu):
  Boas-vindas "Receberam a 1ª mensagem" · Ativação "Ativaram em até 30 dias" · Pré-vencimento "Pagaram até o
  vencimento" · Retenção "Voltaram a usar antes de 90 dias" · Reativação "Voltaram a usar". Sem resultado fechado no
  período: "Ainda sem resultado no período". Momento desligado na estratégia: cartão cinza "Desligado".
  Último cartão (cobranca), fundo cinza: "Foram para a cobrança" com o número do período e "Vieram do Pré-
  vencimento: {%}" (jornada_desfechos com desfecho 'cobranca', momento 'pre_vencimento' ÷ total).
- Nota fixa: "O resultado sai da própria carga diária, sem dado novo. Cada resultado conta para o momento e para o
  último canal que acionou o cliente nos 7 dias anteriores."
- "Para onde os clientes foram": jornada_movimento no período, somando clientes por (de, para), as 6 maiores em barras;
  nomes com rpc rotulo_momento (entrada = "Entrou na carga", voltou_a_usar = "Voltou a usar", cobranca = "Foi para a
  cobrança", fora = "Sem momento"). Nota: "Quem entra em atraso sai da Jornada e fica com a cobrança (MotorCob)."
- "Resultado por canal": seletor de momento (padrão Pré-vencimento) → rpc resultado_jornada(credor, de, ate,
  momento) → Canal · Acionados · {frase do resultado} (taxa) · Custo por {resultado} (custo_por_sucesso, R$ com 2
  casas). Canal "sem ação" = resultado sem ação nos 7 dias anteriores. Nota: "É o que o Melhor canal usa para
  escolher."
- "Quem ficou de fora hoje": jornada_resumo de hoje com motivo diferente de 'com ação hoje', em barras, com os textos:
  "passo do momento já feito; aguarda o próximo" → "Já recebeu o passo; espera o próximo" · "recência entre ações" →
  "Recebeu outra ação há menos de {horas} h" · "sem contato elegível nos canais do passo" → "Sem contato válido nos
  canais do passo" · "em atraso: fica com a cobrança (MotorCob)" → "Em atraso: está com a cobrança" · "passou do
  orçamento do canal no momento (concorre de novo amanhã)" → "Passou do orçamento do canal hoje"; os demais como vêm.
- Os 5 cartões e os cartões das etapas da empresa (prompt 35) continuam; a Lista do dia segue no menu.

## 2. Lista do dia (/jornada/lista)
Colunas ID do cliente · Momento · Passo · Canal (cartões no celular). Momento: rotulo_momento(regua) ("Etapa da
empresa" vira o nome da etapa). Passo: rpc rotulo_passo_jornada(regua, passo) ("5 dias antes do vencimento",
"15 dias depois da contratação", "30 dias sem atividade", "2º ciclo, dia 3"). Quando fila_dia.por_que vier
preenchido, ele aparece embaixo do passo em cinza ("melhor canal: 91% pagam em dia"). Filtros por momento e canal;
"Baixar por canal" como hoje.

Confira em 1440 e 390 px, claro e escuro.
```
