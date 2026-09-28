# Prompt de ajuste do site: Mapa da Esteira

Use depois dos prompts de multiempresa e de estratégias. Antes de colar, aplique no
Supabase a migração `supabase/migrations/20260930000001_mapa_esteira.sql` (SQL Editor ›
New query › colar o conteúdo do arquivo › Run) e deixe a rotina rodar uma vez (é ela que
grava o saldo de cada cliente).

---

```text
Crie a página "Mapa da Esteira" (/mapa) no site MotorCob. O banco já foi alterado — NÃO
crie, altere ou apague tabelas, views, buckets ou políticas. Mantenha o resto do site.
Todos os papéis veem. Tudo filtrado pela empresa selecionada (.eq('empresa_id', id)).
No menu, logo abaixo de "Início".

## Dados
- view mapa_esteira (empresa_id, estado, etapa, canal, cluster, clientes, saldo):
  clientes e saldo por estado × etapa × canal × cluster. Some no navegador conforme os
  filtros.
- view fluxo_esteira (empresa_id, data, de, para, clientes): mudanças de estado por dia;
  de = null é entrada na esteira. Filtre data >= hoje − N dias e some por (de, para).
- view resumo_fila (empresa_id, data, canal, reserva, clientes) com data = hoje, e
  fila_dia (empresa_id, data, id_cliente, tag) com data = hoje para contar "com ação
  hoje" por estado (estado = 3ª parte da tag separada por "-").
- view ultima_execucao da empresa: data/hora da rotina, mostrada no topo.

## Topo
Título "Mapa da Esteira" e a frase "Onde está a base hoje em cada etapa dos acionamentos,
e quem se moveu entre elas." Controles:
- Medir por: Clientes | Saldo (botões segmentados).
- Cluster: Todos + os valores distintos de cluster em mapa_esteira (mostre o nome do
  cluster da tabela clusters quando existir: "VE · Veículo"; os códigos A1…B3 aparecem
  como "Padrão").
- Movimento: últimos 7 dias | últimos 30 dias.
Linha de totais: clientes na esteira (todos menos LIQ), saldo, com ação hoje, data da
rotina.

## Mapa (SVG, largura total, rolagem horizontal no celular)
Caixas fixas, da esquerda para a direita, com uma linha tracejada separando
"Réguas massivas" de "Acordo":
- Entrada (novos na esteira: soma de fluxo_esteira com de = null no período)
- Localização (LOC) e, abaixo, Não CPC (NCP)
- CPC A (CPA) e, abaixo, CPC B (CPB)
- | Acordo: Colchão (COL), Preventivo (PRE), Quebra (QBR)
- Liquidado (LIQ) e Bloqueado (BLQ)
Cada caixa: nome, subtítulo (Cliente novo, Giro, Negociação, Tentativas, Acordo em dia,
Antes do vencimento, Parcela vencida, Quitado, Opt-out/óbito…), o número grande
(clientes ou saldo, conforme "Medir por"), a outra medida menor, "% da base" e "N com ação
hoje". A cor de fundo da caixa vai do claro ao azul-petróleo (#0F4C5C) conforme a
concentração (maior caixa = mais escura); texto branco nas escuras.
Setas curvas entre as caixas para cada par (de, para) do período, com espessura
proporcional à quantidade e o número no meio da seta (mostre o número nas setas mais
grossas e em todas as setas ligadas à caixa selecionada). Tooltip: "Localização → CPC A:
210 clientes".
Clique numa caixa seleciona (borda âmbar #E9A23B) e destaca as setas dela.

## Painel da caixa selecionada (cartões abaixo do mapa)
1. "Por etapa": barras horizontais por etapa, na ordem natural (LOC: L0, L1…; NCP: G1,
   G2, G3 e RE = "Parado · aguarda enriquecimento"; CPB: T1…T3; PRE: D-3, D-1, D0;
   QBR: D1…D5 como "D+1"…). Em NCP, se houver RE, mostre em âmbar: "N clientes parados
   esperando novo enriquecimento: envie o retorno do bureau para eles voltarem ao giro."
2. "Canal da vez" (só CPA, CPB, PRE, QBR, COL): barras por canal (WA WhatsApp, RC RCS,
   AV Agente virtual, DC Discador, SM SMS, EM E-mail, ND Nenhum).
3. "Por cluster": barras por cluster dentro da caixa.
4. "Movimento": chips com de onde vieram e para onde foram os clientes no período.
Estado vazio (empresa sem rotina ainda): "O mapa aparece depois da primeira rotina desta
empresa."
Não existe telefone, e-mail ou CPF nessas views — não tente exibir.
```
