# Prompt de ajuste do site: Personas e sugestões

Antes de colar, rode no Supabase (SQL Editor › New query › colar o conteúdo › Run)
`supabase/migrations/20261003000001_personas.sql` (pode rodar mais de uma vez).

---

```text
Crie a página "Personas" no site MotorCob e duas etiquetas novas no Desenho da Esteira.
NÃO crie, altere ou apague tabelas, views, buckets ou políticas. Tudo filtrado pela
empresa selecionada (.eq('empresa_id', id)). No menu, logo depois de "Orquestração".

## Dados
- personas (empresa_id, persona, nome, clientes, condicoes jsonb [{campo, valor}],
  ranking jsonb [{canal, taxa_cpc, tentativas, cpcs, custo_por_cpc}], caracteristicas
  jsonb [colunas], atualizado_em): refeita pela rotina todo dia.
- sugestoes (id, empresa_id, chave, texto, dados jsonb, status pendente | aprovada |
  recusada | aplicada, criada_em, decidida_em, aplicada_em). dados tem: nome (persona),
  clientes, condicoes, estrategia_nome, dia, de, para, evidencia {canal: {taxa_cpc,
  tentativas, custo_por_cpc}}, ganho_cpc_por_rodada.

## Página Personas (/personas) — todos veem; admin e planejamento decidem sugestões
Topo: "Personas" e a frase "Clientes parecidos respondem pelos mesmos canais. O MotorCob
aprende com as ocorrências e escolhe, para cada cliente, o canal que mais dá CPC por real
gasto." Abaixo, chips com as características que o motor escolheu (personas.caracteristicas
da primeira linha), ex.: "UF", "faixa_saldo" — com o texto "Escolhidas automaticamente:
são as que mais mudam a resposta por canal". Data da última atualização.

### Sugestões (no topo, só se houver status = pendente)
Cartões âmbar, um por sugestão: o texto (sugestoes.texto), "Afeta N clientes", a
comparação lado a lado dos dois canais (dados.evidencia: taxa de CPC em %, tentativas,
custo por CPC em R$) e "Ganho estimado: +X CPCs por rodada". Botões "Aprovar" (update
status = 'aprovada') e "Recusar" (status = 'recusada'). Depois de aprovar: "Aprovada ·
entra na rotina de amanhã como um segmento novo na Orquestração." Histórico recolhido
"Decididas" com as aprovadas/recusadas/aplicadas e a data.

### Lista de personas
Um cartão por persona (ordem por clientes), com: nome (ex.: "UF RJ · faixa_saldo 500 a
2 mil"), quantos clientes da carga, e o ranking de canais em barras horizontais: canal
(com a cor do canal), taxa de CPC em %, custo por CPC em R$ e tentativas. O 1º canal com
o selo "★ melhor canal". Canal com menos de 30 tentativas aparece em cinza com "pouco
histórico". Se a tabela estiver vazia: "As personas aparecem depois de algumas semanas
de ocorrências (CPC sim/não). Até lá, ★ usa a média da carteira."

## Desenho da Esteira (Orquestração)
Na barra de canais, depois dos 6 canais, dois chips com borda tracejada âmbar:
"★ Melhor canal da persona" (canal = "persona_1") e "☆ 2º melhor da persona"
(canal = "persona_2"). Funcionam como qualquer canal (arrastar ou tocar), gravando
{"canal": "persona_1", "modo": ...} em definicao. Nas frases de "Como vai funcionar",
escreva "o melhor canal da persona do cliente". Nota sob a barra: "★ e ☆: o MotorCob
escolhe para cada cliente; 10% dos clientes testam outro canal para o aprendizado não
parar."
```
