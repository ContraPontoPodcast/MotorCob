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
- view mapa_esteira (empresa_id, estado, etapa, canal, cluster, safra, clientes, saldo):
  clientes e saldo por estado × etapa × canal × cluster × safra (AAAA-MM de entrada).
  Leia uma vez por empresa e some no navegador conforme o mapa e os filtros.
- view acoes_hoje (empresa_id, data, regua, passo, canal, reserva, clientes): a fila do
  dia agregada por régua × passo × canal.
- view fluxo_esteira (empresa_id, data, de, para, clientes): mudanças de estado por dia;
  de = null é entrada na esteira. Filtre data >= hoje − N dias e some por (de, para).
- view resumo_fila (empresa_id, data, canal, reserva, clientes) com data = hoje, e
  fila_dia (empresa_id, data, id_cliente, tag) com data = hoje para contar "com ação
  hoje" por estado (estado = 3ª parte da tag separada por "-").
- view ultima_execucao da empresa: data/hora da rotina, mostrada no topo.

## Topo
Título "Mapa da Esteira" e a frase "Onde está a base hoje em cada etapa dos acionamentos,
e quem se moveu entre elas." Controles:
- Mapa (o primeiro controle, em destaque): escolhe a visão —
  "Esteira · etapas e movimento" (padrão), "Clusters × etapas", "Canais × etapas",
  "Safras × etapas", "Ações de hoje · régua × canal".
- Medir por: Clientes | Saldo (botões segmentados).
- Cluster: Todos + os valores distintos de cluster em mapa_esteira (mostre o nome do
  cluster da tabela clusters quando existir: "VE · Veículo"; os códigos A1…B3 aparecem
  como "Padrão").
- Canal: Todos, WhatsApp (WA), RCS (RC), Agente virtual (AV), Discador (DC), SMS (SM),
  E-mail (EM), Nenhum (ND = ainda sem canal).
- Safra: Todas + os meses distintos de safra (mostre "set/26").
- Movimento: últimos 7 dias | últimos 30 dias.
Os filtros valem para todos os mapas e se combinam. Abaixo dos controles, chips com os
filtros ativos ("Cluster: VE ✕", "Canal: WhatsApp ✕", "Limpar filtros") ou "Sem filtros:
base inteira.". Guarde mapa e filtros na URL (?mapa=cluster&cluster=VE…) para poder
compartilhar a visão.
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

## Mapas em tabela (Clusters, Canais, Safras × etapas)
Tabela-mapa de calor: linhas = clusters / canais / safras; colunas = Localização, Não CPC,
CPC A, CPC B, Preventivo, Colchão, Quebra, Bloqueado, Liquidado, Total. Cada célula mostra
clientes ou saldo e tem fundo do claro ao azul-petróleo conforme o valor (texto branco
nas escuras; célula zerada mostra "·"). Legenda curta acima da tabela explicando a
visão. Clicar no nome da linha aplica (ou tira) aquele filtro. Clicar numa célula aplica
o filtro da linha e seleciona a etapa da coluna, abrindo o painel abaixo (borda âmbar
na célula selecionada). Tabela com rolagem horizontal no celular.

## Ações de hoje
Tabela-mapa de calor com linhas = régua · passo (ex.: "Localização · D+1", "CPC B · T2")
e colunas = canais (a reserva aparece como "Discador (reserva)"), com total por linha.
Respeita os filtros de cluster/canal/safra só quando der para cruzar com fila_dia (se não
der, mostre a nota "Ações de hoje não usa os filtros de cluster e safra").

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
