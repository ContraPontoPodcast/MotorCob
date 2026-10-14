# Prompt Horizons — 42: Mapa da Esteira legível (bloco 3)

Rode depois do SQL 31. Protótipo aprovado: `docs/homologacao/bloco3-orquestracao-prototipo.html` (aba Mapa).

```text
Plataforma › Operação › Mapa da Esteira (motorcob.online). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Cartões na ordem da jornada
Troque a grade de hoje por cartões em duas faixas, da esquerda para a direita:
- Massivas: Cliente novo → Não CPC → CPC · em negociação → CPC · sem resposta
- Acordo: Acordo em dia → Acordo · antes do vencimento → Acordo · parcela vencida → Quitado
Bloqueado fica num cartão cinza à parte. Cada cartão: nome da fase, tamanho na base (clientes ou saldo, conforme
"Medir por"), barra fina com o % da base, e "+ entraram / − saíram" no período (7 ou 30 dias).
Clique no cartão abre o detalhe da fase em barras horizontais por passo, com os rótulos legíveis.

## 2. Nenhum código cru
Use as funções do banco para todo texto de fase e passo:
- rpc/SQL rotulo_estado(estado): LOC → "Cliente novo", NCP → "Não CPC", CPA → "CPC · em negociação",
  CPB → "CPC · sem resposta", PRE → "Acordo · antes do vencimento", COL → "Acordo em dia",
  QBR → "Acordo · parcela vencida", LIQ → "Quitado", BLQ → "Bloqueado".
- rotulo_ciclo(estado, ciclo): G1 → "1º ciclo", RE → "Parado · aguarda enriquecimento" (em âmbar, com
  "N clientes parados esperando o bureau"), T2 → "2ª tentativa", L3 → "D+3", QBR D2 → "D+2".
- rotulo_passo(passo): "G2-dia3" → "2º ciclo · dia 3"; "CPC B · T1" → "CPC · sem resposta · 1ª tentativa".
Se for mais simples, aplique as mesmas regras no front com uma tabela fixa — o texto tem de ser idêntico.
Na tela do cliente, a TAG (S260801-A1-CPB-WA-T2) vira a frase "CPC · sem resposta · 2ª tentativa no WhatsApp ·
segmento A1 · entrou em ago/26"; a TAG crua fica só em "Ver detalhe técnico", recolhido.

## 3. Movimento entre fases
"Os maiores fluxos do período, do maior para o menor": barras horizontais "Cliente novo → CPC · em negociação
· 320". Verde = avanço (CPC, acordo, quitação); vermelho = recuo (quebra, virou Não CPC, bloqueio).

Filtros no topo: Carteira (com "Todas"), Medir por (Clientes · Saldo), Período (7 · 30 dias), Segmento, Canal.
Confira em 1440 e 390 px.
```
