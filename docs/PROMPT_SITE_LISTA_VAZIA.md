# Prompt de ajuste do site: por que a lista do dia está vazia e quando sai a próxima

Não precisa de SQL novo. Precisa do motor atualizado no Mac (`git pull`): a rotina grava em
`execucoes.resumo` as chaves `sem_acao` e `proximos` (e o arquivo `previsao.json` do dia).

---

```text
Na página "Lista do dia", quando não houver lista (ou mesmo quando houver), mostre POR QUE os
clientes ficaram sem ação hoje e QUANDO sai a próxima lista. NÃO crie, altere ou apague
tabelas, views, buckets ou políticas.

## Dados
Última execução da carteira para a data escolhida:
execucoes.select("resumo, iniciada_em, status").eq("empresa_id", empresa).eq("credor_id",
carteira).eq("data_ref", data).order("iniciada_em", desc).limit(1).
- resumo.sem_acao: {motivo: clientes}. Rótulos:
  com_acao "Com ação hoje" · sem_passo_hoje "A esteira não tem passo hoje (ex.: D+2)" ·
  intervalo_48h "Aguardando 48h desde a última ação (localização e Não CPC)" ·
  intervalo_cpc "CPC: aguardando o intervalo de acionamento da estratégia" ·
  sem_contato "Sem contato para os canais do dia" · sem_acao_na_raia "Persona com 'sem ação'
  hoje" · bureau_hoje "Só enriquecimento hoje" · outro_credor "Acionados por outra carteira
  nas últimas 48h" · demais_desligado "Demais clientes desligado" · fora_da_carga "Fora da
  carga (retirados/quitados)" · encerrado "Bloqueados, liquidados ou encerrados" ·
  domingo_feriado "Domingo, feriado ou dia sem exportação no calendário".
- resumo.proximos: [{data, clientes, passos: {"localizacao D+3": n, ...}, sem_acoes?}] para os
  próximos 7 dias (estimativa).

## 1. Lista vazia
No lugar de "Nenhuma lista disponível em {data}. Ainda não gerado para esta data.":
- se NÃO houver execução para a data: manter o texto atual + "A rotina desta data ainda não
  rodou" e o botão "↻ Reenquadrar agora" (admin e planejamento; mesmo comportamento do botão da
  Orquestração).
- se houver execução: cartão âmbar "Nenhum cliente com ação em {data}" com a lista dos motivos
  (barra horizontal por motivo, do maior para o menor, com o número e o rótulo) e, em destaque,
  "Próxima lista: {dia da semana, dd/mm} com cerca de {clientes} clientes ({passos})" usando o
  primeiro item de proximos com clientes > 0. Se nenhum: "Nenhuma ação prevista nos próximos 7
  dias: confira a esteira" com link para a Orquestração.

## 2. Sempre (com ou sem lista)
Abaixo dos cartões de canal, o bloco recolhível "Próximos dias": uma linha por item de
proximos — dia da semana e data, nº de clientes, e os passos como chips ("D+3 · 9.812");
domingo/feriado em cinza "sem ações". Rodapé: "Estimativa pela esteira de hoje; muda com os
retornos (CPC) e com novas cargas. A lista de cada dia sai sozinha a partir das 06:00."
E acima dos cartões, uma linha discreta com os motivos de hoje (ex.: "9.812 com ação · 150 sem
contato · 38 fora da carga").
```
