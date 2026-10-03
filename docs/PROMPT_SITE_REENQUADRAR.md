# Prompt de ajuste do site: botão "Reenquadrar agora"

Antes de colar, rode no Supabase `supabase/migrations/20261014000001_pedidos_rotina.sql` (ou o
`supabase/atualizar_producao_2026-10.sql`, que já inclui). Pode rodar mais de uma vez.
Precisa da vigia em tempo real no Mac (`scripts/instalar_mac.sh vigiar`).

---

```text
Crie o botão "Reenquadrar agora": depois de ajustar a orquestração, o usuário pede, o MotorCob
roda a rotina da carteira na hora (reenquadra os clientes e refaz a lista do dia) e o site mostra
o novo enquadramento. NÃO crie, altere ou apague tabelas, views, buckets ou políticas.

## Dados
- pedidos_rotina (id, empresa_id, credor_id, status 'pendente'|'rodando'|'ok'|'erro', pedido_em,
  iniciado_em, terminado_em, execucao_id, erro). O site só faz INSERT com {credor_id: carteira
  do topo} (a empresa é preenchida pelo banco) e SELECT. Status quem grava é o MotorCob.
  Só admin e planejamento podem pedir. Um pedido por carteira na fila: se o insert der erro de
  duplicidade (unique), mostre "Já tem um reenquadramento na fila desta carteira".
- view enquadramento e execucoes: para mostrar o resultado.

## 1. Botão
"↻ Reenquadrar agora" (admin e planejamento) em dois lugares:
- no topo da Orquestração da carteira, ao lado de Salvar;
- no topo da página/aba de Enquadramento da carteira.
Ao clicar, confirmar: "Reenquadrar a carteira {nome} com a orquestração atual? Os clientes são
reclassificados nos segmentos e personas e a lista de ações de HOJE é refeita (se você já mandou
os arquivos de hoje aos fornecedores, confira o que mudou)." → insert em pedidos_rotina.

## 2. Acompanhamento (faixa abaixo do botão, some 1 minuto depois de terminar)
Leia o último pedido da carteira (order id desc limit 1) a cada 3 s enquanto status for
pendente ou rodando:
- pendente: "Na fila… o MotorCob pega em segundos". Se passar de 2 minutos pendente, âmbar:
  "O MotorCob ainda não pegou o pedido: confira se o Mac está ligado e a vigia ativa
  (scripts/diagnostico.sh)".
- rodando: spinner "Reenquadrando… (em geral 1 a 3 minutos)".
- ok: verde "Reenquadrado às {terminado_em hh:mm}" e RECARREGUE os dados do enquadramento, do
  Mapa e da lista do dia na tela (sem F5). Botão "Ver enquadramento".
- erro: vermelho com o texto do campo erro.
Enquanto pendente/rodando, o botão fica desabilitado ("Reenquadrando…").

## 3. Comparar antes × depois
Na aba Enquadramento, ao abrir depois de um reenquadramento ok, mostre por segmento e por
persona a coluna "Antes" (contagem guardada no navegador logo antes de pedir) ao lado da
atual e a diferença (+/−), para o usuário ver se o ajuste deu o efeito esperado. Botão
"Limpar comparação".

## 4. Depois de salvar a orquestração
Toast com ação: "Orquestração salva · o MotorCob reenquadra sozinho em até 1 minuto" e o botão
"Reenquadrar agora" (mesmo comportamento acima).
```
