# Prompt de ajuste do site: motivo de cada cliente estar (ou não) na lista de hoje

Antes de colar, rode no Supabase `supabase/migrations/20261015000001_motivo_hoje.sql` (ou o
`supabase/atualizar_producao_2026-10.sql`, que já inclui). Pode rodar mais de uma vez.

---

```text
Mostre POR QUE cada cliente está ou não na lista de hoje. NÃO crie, altere ou apague tabelas,
views, buckets ou políticas.

## Dados
- estado_cliente.motivo_hoje (texto pronto, preenchido pela rotina): "com ação hoje" ou
  "sem ação: …" (ex.: "sem ação: a esteira não tem passo no D+2", "sem ação: sem contato para
  os canais do dia", "sem ação: Demais clientes desligado", "sem ação: persona com 'sem ação'
  hoje", "sem ação: acionados por outra carteira nas últimas 48h").
- view motivos_hoje (empresa_id, credor_id, motivo, clientes): contagem por motivo dos
  clientes da carga.

## 1. Lista do dia e Mapa
Bloco "Por que hoje" (sempre visível quando houver dados): barras horizontais da view
motivos_hoje desta carteira, do maior para o menor; "com ação hoje" em verde, os "sem ação: …"
em âmbar. Clicar num motivo abre a aba Clientes já filtrada por ele.

## 2. Aba Clientes
Nova coluna "Hoje" com o motivo_hoje (verde se começa com "com ação", âmbar se "sem ação").
Novo filtro "Hoje" com os motivos da view (select). A coluna "Ação de hoje" continua.

## 3. Página do cliente
No cabeçalho, ao lado da TAG, o selo com o motivo_hoje.
```
