# Prompt de ajuste do site: enriquecimento na esteira e prioridade dos telefones

Antes de colar, rode no Supabase `supabase/migrations/20261008000001_enriquecimento_esteira.sql`
(ou o `supabase/atualizar_producao_2026-10.sql`, que já inclui). Pode rodar mais de uma vez.

---

```text
Coloque o ENRIQUECIMENTO (bureau) na orquestração e a regra de PRIORIDADE DOS TELEFONES. NÃO
crie, altere ou apague tabelas, views, buckets ou políticas. Tudo continua gravando no mesmo
estrategias.definicao (jsonb) e filtrado pela carteira.

## 1. Desenho da Esteira — ação "Enriquecimento"
- Na barra de canais, depois dos 6 canais e das fichas ★/☆, um chip diferente (fundo cinza
  claro, borda sólida, ícone de lupa): "Enriquecimento (bureau)" → canal = "enriquecimento".
- Pode ser colocado em qualquer dia das faixas Cliente novo, Não CPC, Preventivo e Quebra
  (NÃO na faixa de CPC: lá mostre o aviso "Enriquecimento vai nos dias da esteira").
- Não entra na cadeia de canais: não tem botão senão/junto/reserva; grava
  {"canal": "enriquecimento"} no dia, e aceita o botão "Público" (personas), como os outros.
- No chip: "Enviar ao bureau". Em "Como vai funcionar": "D+1: SMS; envia ao bureau no D+3".
- Nota fixa abaixo da faixa Cliente novo: "Sem enriquecimento na esteira, o MotorCob manda o
  cliente ao bureau no dia da carga (D+1). O mesmo cliente não volta ao bureau antes de 30
  dias. Quando o bureau devolver, envie o retorno em Arquivos › Atualização de contatos: os
  telefones voltam com Score e Ranking e passam a seguir a prioridade abaixo."

## 2. Desenho da Esteira — bloco "Prioridade dos telefones"
Bloco recolhível depois das faixas, gravando definicao.prioridade_contatos:
{"criterios": [{"campo": ..., "sentido": "asc"|"desc"}, ...], "score_minimo": n, "ranking_maximo": n}
- Lista ordenável (arrastar ou ‹ ›) de critérios, cada um com um select e o sentido:
  "Ranking do bureau" (campo ranking; padrão "menor primeiro" = asc),
  "Score do bureau" (score; padrão "maior primeiro" = desc),
  "Tem WhatsApp" (whatsapp; "primeiro" = desc), "Tem RCS" (rcs; desc),
  "Veio do bureau" (bureau; desc). Botão "+ critério"; × para tirar.
- Filtros: "Descartar telefones com score abaixo de [número]" (score_minimo) e "Descartar
  telefones com ranking acima de [número]" (ranking_maximo). Vazio = não descarta.
- Texto: "Vale para escolher qual telefone vai em cada ação, depois do telefone Hot e do
  rodízio (cada passagem usa o próximo telefone). Telefone sem Score/Ranking não é descartado
  e vai depois dos que têm."
- Em "Como vai funcionar", uma frase: "Telefones: ranking menor primeiro, depois score maior;
  descarta score abaixo de 3."
- "Começar do playbook MotorCob" não preenche este bloco (fica sem regra).

## 3. Lista do dia (aba da carteira)
Para admin e planejamento, um cartão "Arquivo para o bureau" quando existir
saidas/{slug}/{data}/{codigo do credor}/bureau/enviar_bureau.csv: botão "Baixar" e quantos
clientes (linhas − 1). Texto: "CPF/CNPJ e ID dos clientes que a esteira mandou enriquecer hoje."
O detalhe (motivo de cada um) está em enriquecimento.csv na mesma pasta do dia.

## 4. Aba Clientes e Visão geral
- Aba Clientes: colunas "Enviado ao bureau" (estado_cliente.enriq_enviado, dd/mm) e "Retorno do
  bureau" (enriq_retorno) e o filtro "Aguardando retorno do bureau" (enviado preenchido e
  retorno vazio ou anterior ao envio).
- Visão geral: no checklist, o item "Retorno do bureau" com ✓ se não houver clientes aguardando
  há mais de 3 dias; senão ✕ "N clientes aguardando o retorno do bureau" → aba Arquivos.
```
