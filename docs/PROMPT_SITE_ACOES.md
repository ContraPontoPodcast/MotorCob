# Prompt de ajuste do site: Ações realizadas

Antes de colar, rode no Supabase (SQL Editor › New query › colar o conteúdo › Run)
`supabase/migrations/20261004000001_acoes_dia.sql` — ou, se ainda não rodou as
atualizações de outubro, só `supabase/atualizar_producao_2026-10.sql`, que já inclui esta.
Os dois podem ser rodados mais de uma vez.

---

```text
Crie a página "Ações" no site MotorCob e um cartão "Ações de ontem" no Início.
NÃO crie, altere ou apague tabelas, views, buckets ou políticas. Tudo filtrado pela
empresa selecionada (.eq('empresa_id', id)). Todos os papéis veem (só leitura). No menu,
logo depois de "Lista do dia".

## Dados
Tabela acoes_dia (só totais, sem cliente): empresa_id, data, canal, regua, cluster,
persona, enviadas, reservas, com_retorno, retornos, cpcs, custo, primeiros_cpc,
acoes_ate_primeiro_cpc, atualizado_em. A rotina diária regrava os últimos 60 dias.
- Uma ação = um cliente acionado num canal num dia (3 números no discador = 1 ação).
- Sempre SOME as linhas (os números são aditivos) e só depois divida:
  Taxa de retorno = com_retorno ÷ enviadas · Taxa de CPC = cpcs ÷ enviadas ·
  Custo por CPC = custo ÷ cpcs · Média de ações até o 1º CPC =
  acoes_ate_primeiro_cpc ÷ primeiros_cpc. Divisão por zero → "—".
- Nomes na tela:
  canal: whatsapp WhatsApp (#1F8A4C) · rcs RCS (#3B5BA9) · sms SMS (#7A4FB0) ·
  email E-mail (#A2552B) · agente_voz Agente virtual (#0E7C86) · discador Discador (#475569).
  regua (momento): localizacao "Cliente novo" · cpc "CPC A / B" · giro "Não CPC" ·
  preventivo "Preventivo" · quebra "Quebra" · fora_da_lista "Fora da lista".
  cluster vazio = "Demais clientes"; persona vazia = "Sem persona".
- Busque com paginação (range de 1000 em 1000) até acabar.

## Página Ações (/acoes)
Topo: "Ações" e a frase "Quantas ações o MotorCob mandou fazer e o que voltou delas.
Os números de um dia se completam quando a ocorrência da empresa chega."

### Filtros (barra fixa)
- Período: botões "Ontem", "7 dias" (padrão), "30 dias", "60 dias" e "Personalizado"
  (duas datas).
- Agrupar por: "Dia" (padrão), "Semana" (segunda a domingo), "Mês".
- Selects múltiplos: Canal, Momento (regua), Segmento (cluster), Persona — opções
  vindas dos valores existentes no período. "Limpar filtros".
- Os filtros ficam na URL (?de=…&ate=…&canal=…) para dar para compartilhar.

### Cartões (do período e dos filtros)
6 cartões: "Ações enviadas" (enviadas; embaixo, pequeno, "+ N reservas exportadas"),
"Com retorno" (com_retorno e a taxa de retorno em %), "CPC" (cpcs e a taxa de CPC em %),
"Custo" (R$), "Custo por CPC" (R$), "Ações até o 1º CPC" (média, uma casa decimal;
embaixo "em N clientes que deram o 1º CPC"). Ao lado de cada número, a variação em
relação ao período anterior do mesmo tamanho (seta verde/vermelha; para custo e custo
por CPC, subir é vermelho).

### Gráfico
Barras empilhadas por canal (cores acima) com as ações enviadas em cada dia/semana/mês e
uma linha (eixo da direita) com a taxa de CPC. Passar o mouse mostra o detalhe por canal.
Dias sem ação (domingo, feriado) aparecem vazios, sem sumir do eixo.

### Tabela por canal
Linhas = canais (+ linha "Total" em negrito); colunas: Enviadas · Com retorno · % retorno ·
CPC · % CPC · Custo · Custo por CPC · Ações até o 1º CPC. Clicar no cabeçalho ordena.
Acima, abas para trocar a quebra da tabela: "Por canal" (padrão), "Por momento",
"Por segmento", "Por persona". Botão "Baixar CSV" com o que está na tela.

### Avisos (âmbar, no topo, só se houver)
- Ações sem ocorrência: para cada dia útil do período (exceto hoje) e canal com
  enviadas > 0 e com_retorno = 0: "DD/MM · Discador: 1.240 ações sem ocorrência de volta.
  Envie o arquivo de ocorrência em Enviar arquivos para o MotorCob contar CPC e custo."
  Agrupe num cartão só, com no máximo 5 linhas e "ver todos".
- Fora da lista: se houver linhas com regua = 'fora_da_lista': "N ocorrências não batem
  com ações do MotorCob (a empresa acionou por fora ou mandou o ID errado)." Essas linhas
  entram em "Com retorno" e "CPC" mas não em "Ações enviadas".

Se acoes_dia estiver vazia: "As ações aparecem depois da primeira rotina do MotorCob. O CPC
e o custo aparecem quando chegar a ocorrência da empresa."

## Início — cartão "Ações de ontem"
Logo abaixo do funil: soma das linhas de acoes_dia com data = último dia com ações antes de
hoje. Mostre "Ações de DD/MM": enviadas · com retorno (%) · CPC (%) · custo (R$), e uma
mini-barra por canal (cores acima) com as enviadas. Embaixo, pequeno: "Últimos 7 dias:
N ações · N CPC · R$ X por CPC". Se aquele dia tiver canal com ações e sem retorno, o
aviso âmbar "Falta a ocorrência de DD/MM (Discador, SMS)". Link "Ver ações" → /acoes.
```
