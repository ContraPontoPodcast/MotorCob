# Prompt Horizons — 56: Faturamento do cliente e acesso bloqueado (substitui partes dos prompts 2, 31 e 32)

Rode depois do SQL 37, da função `cobranca` nova e do prompt 55. Protótipo aprovado em 15/10/2026:
`docs/homologacao/faturas-contratacao-prototipo.html` (telas de faturamento do cliente).

```text
Plataforma do cliente (motorcob.online). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Acesso bloqueado (empresa inadimplente)
Ao entrar e a cada troca de tela, rpc acesso_da_empresa(empresa_id) → situacao, bloqueada, motivo, desde.
Com bloqueada = true e situacao = 'inadimplente': faixa vermelha fixa no topo de todas as telas "A fatura está
vencida há mais de 10 dias. O acesso está bloqueado e os envios estão parados. Pague em Faturamento para liberar;
volta sozinho quando o pagamento confirmar." + botão "Pagar agora". O menu mostra tudo, mas só Faturamento e
Suporte abrem; as outras telas aparecem travadas com "Acesso bloqueado por fatura vencida". Suspensa ou encerrada:
mesma faixa com o texto "Acesso suspenso pela equipe MotorCob. Fale com o Suporte."
Liberada pelo Master (bloqueada = false e liberada_ate preenchida, com fatura vencida): faixa âmbar "Acesso
liberado pela MotorCob até {liberada_ate}. A fatura continua em aberto: pague até lá para não bloquear de novo."
+ "Pagar agora".

## 2. Faturamento pós-pago (Empresa › Faturamento; ver_faturamento)
- Primeiro cartão: a fatura em aberto (faturas_painel, situacao_atual 'aberta' ou 'vencida'): "Fatura de {mês}",
  valor grande, vencimento e para quem foi o e-mail; pílula "Vence em N dias" (âmbar a partir de 5), "Vencida há N
  dias" (vermelha). Botões Pagar com Pix · Boleto · Cartão (função cobranca, acao 'pagar', como no prompt 32),
  links Demonstrativo (PDF) e Nota fiscal. Sem a permissão pagar_faturas: os botões viram a etiqueta com cadeado
  "Só quem pode pagar faturas paga (Admin, por padrão)".
- Segundo cartão: "{Mês} até agora" com rpc estimativa_ciclo(empresa_id): valor ate_agora grande, "dia {dia} de
  {dias}" e, quando estimativa vier preenchida (a partir do 5º dia): "Estimativa até o fim do ciclo, no ritmo
  atual: cerca de {estimativa}. É só uma conta do ritmo; a fatura usa o consumo real."
- "Itens de {mês}": cada item da fatura com quantidade, preço e valor. Preço unitário abaixo de R$ 0,10 aparece
  por mil ("R$ 54,00 por mil SMS"); no preço por faixa, a conta escrita abaixo da tabela ("os primeiros 50 mil SMS
  saem a R$ 54,00 por mil; os 11.420 seguintes, a R$ 49,00 por mil").
- "Faturas anteriores": Mês de · Situação · Vencimento · Valor (no celular, cartão com os quatro).

## 3. Faturamento pré-pago
- Cartão "Saldo" (saldo_empresa) com pílula "Saldo baixo"/"Saldo esgotado"; abaixo, rpc duracao_saldo(empresa_id):
  com dias_restantes, "Dura cerca de {dias_restantes} dias no ritmo dos últimos 7 dias ({media_dia} por dia)";
  sem (menos de 3 dias de uso), nada. Botões "Recarregar" (solicitar_recarga; só com pagar_faturas) e "Recarga
  automática".
- "Extrato do saldo": rpc extrato_saldo(empresa_id, de, ate) → dia, tipo ('consumo' | 'recarga'), descricao,
  valor (negativo no consumo), saldo_depois. Período padrão: últimos 30 dias. Consumo em cinza com o sinal −,
  recarga em verde com +. Nota: "Consumo do dia pelo preço médio do item no ciclo; o total do ciclo bate com o
  demonstrativo."
- "Recargas": data, forma, situação, valor.

## 4. Permissões (Empresa › Usuários › Permissões)
Nova linha no catálogo: "Pagar faturas e recarregar" (pagar_faturas), marcada só para Admin. Ver o faturamento
continua em "Ver faturamento".

Confira em 1440 e 390 px, claro e escuro.
```
