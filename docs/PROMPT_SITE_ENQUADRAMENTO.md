# Prompt de ajuste do site: onde cada cliente se enquadrou

Antes de colar, rode no Supabase `supabase/migrations/20261006000001_enquadramento.sql` (ou o
`supabase/atualizar_producao_2026-10.sql`, que já inclui). Pode rodar mais de uma vez.

---

```text
Na página da carteira, crie a aba "Clientes" (logo depois de "Visão geral"), que mostra onde
cada cliente da carteira se enquadrou. NÃO crie, altere ou apague tabelas, views, buckets ou
políticas. Tudo filtrado por empresa e .eq('credor_id', id da carteira). Se a página da
carteira ainda não existir, crie a página /clientes com um select de carteira no topo.

## Dados
- view enquadramento (empresa_id, credor_id, cluster, estrategia, estado, na_carga, clientes,
  com_acao_hoje, saldo): o resumo.
- estado_cliente (id_cliente, cluster_atual, estado, ciclo, canal, saldo, dias_atraso,
  estrategia, persona, na_carga, acao_hoje, passo_hoje, atualizado_em): um cliente por linha.
- clusters (codigo, nome) para mostrar o nome do segmento: "VE · Veículo"; código sem regra
  (A1…B3) = "Demais clientes".
Nomes do momento (estado): LOC "Novo · localizando", NCP "Não CPC", CPA "CPC A",
CPB "CPC B", PRE "Preventivo", COL "Acordo em dia", QBR "Quebra", LIQ "Liquidado",
BLQ "Bloqueado". Canal da vez (canal): WA WhatsApp, RC RCS, AV Agente virtual, DC Discador,
SM SMS, EM E-mail, ND "—".

## 1. Resumo "Como a carteira se dividiu" (no topo)
Uma linha de cartões: "Na carga" (soma clientes com na_carga), "Com ação hoje"
(com_acao_hoje), "Fora da carga" (na_carga = false: retirados/quitados, sem ação),
"Saldo em cobrança" (R$, só na_carga).
Abaixo, a matriz "Segmento × Momento" (linhas = segmento com o nome da esteira embaixo em
cinza, colunas = momentos na ordem acima, célula = clientes e, menor, o saldo). Fundo do claro
ao azul-petróleo (#0F4C5C) conforme o valor. Clicar numa célula filtra a lista abaixo.
Botão "Só na carga" ligado por padrão (esconde na_carga = false).

## 2. Lista de clientes
Tabela paginada (50 por página, ordem por saldo decrescente) com: ID do cliente · Segmento ·
Esteira (estrategia) · Momento (estado + etapa ciclo: "Novo · L2", "CPC B · T1") · Persona ·
Canal da vez · Ação de hoje (acao_hoje; vazio = "—"; com "(reserva)" em cinza) · Passo
(passo_hoje, ex.: "localizacao D+3") · Saldo (R$) · Atraso (dias) · Na carga (✓ / "fora").
Filtros em chips: Segmento, Esteira, Momento, Persona, "Com ação hoje", "Só na carga", e
busca por ID. Clicar na linha abre a página Cliente (TAG decomposta e trilha).
Botão "Baixar CSV" com os filtros aplicados (as mesmas colunas).
Texto acima da tabela: "Atualizado na rotina das HH:MM" (max atualizado_em).
Se estrategia vier vazia em todas as linhas: aviso "Rode a atualização do banco e aguarde a
próxima rotina para ver a esteira de cada cliente."

## 3. Página Cliente
Acrescente no cartão do cliente: Esteira, Persona, Ação de hoje e Passo (mesmos campos).
```
