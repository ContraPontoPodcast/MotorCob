# Prompt Horizons — 58: Faturamento do cliente com acordo de pagamento (complementa o prompt 56)

Rode depois do SQL 38, da função `cobranca` nova e do prompt 56. Protótipo aprovado em 15/10/2026:
`docs/homologacao/acordo-fatura-prototipo.html` (telas "E-mail do acordo" e "Faturamento com acordo").

```text
Plataforma do cliente (motorcob.online). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Faixa do acordo (topo de todas as telas, como a do prompt 56)
Ao entrar e a cada troca de tela, junto com acesso_da_empresa: rpc acordos(empresa_id), primeiro da lista.
- em_dia: faixa âmbar "Acordo de pagamento em dia. Próxima parcela: {proxima_valor} em {proxima_vencimento dd/mm}.
  O acesso fica liberado enquanto as parcelas estiverem em dia." + "Pagar agora" (vai para Faturamento). Esta
  aparece só no Início e em Faturamento; as outras duas, em todas as telas.
- parcela_vencida: faixa vermelha "A {proxima_numero}ª parcela do acordo venceu há {dias_atraso} dias. Pague até
  {quebra_em − 1 dd/mm} para não desfazer o acordo e bloquear o acesso." + "Pagar agora".
- quebrado com saldo aberto: a faixa de acesso bloqueado do prompt 56 já aparece; troque o texto por "O acordo de
  pagamento foi desfeito. O que falta, {valor_restante}, voltou a ser cobrado: pague em Faturamento para liberar."
- A faixa de acesso bloqueado tem prioridade; nunca mostre duas faixas.

## 2. Empresa › Faturamento (ver_faturamento)
Antes do cartão da fatura em aberto, um cartão por acordo em andamento ou quebrado com saldo (acordos):
título "Acordo de pagamento · faturas de {meses das competencias}" + pílula (em_dia "Em dia", parcela_vencida
"Parcela vencida", quebrado "Desfeito", quitado "Quitado").
- Tabela Parcela · Situação · Vencimento · Valor · ação, de acordo_parcelas (acordo_id = id, situacao <> 'cancelada'):
  "{numero}ª de {parcelas}" (tipo 'saldo': "Saldo do acordo"); Situação: Paga (verde) / "Vence em N dias" /
  "A vencer" / "Vencida há N dias" (vermelha); paga mostra "· paga em {dd/mm}".
- Ação: parcela em aberto → botões Pix · Boleto · Cartão só das formas do acordo (acordos.formas) → função
  cobranca { acao: 'pagar', parcela: id, forma } → mostre o Pix copia e cola, o boleto ou abra o cartão, igual à
  fatura. Parcela paga com link_nota_fiscal → "Nota fiscal". Sem pagar_faturas: etiqueta com cadeado "Só quem pode
  pagar faturas paga (Admin, por padrão)".
- Rodapé do cartão: "{Desconto | Acréscimo} de {|ajuste|} sobre {valor_faturas}. Se uma parcela ficar 10 dias em
  atraso, o acordo é desfeito." (sem o motivo: ele não vem para o cliente).
- Fatura em acordo (faturas_painel.situacao_atual = 'em_acordo') sai do cartão "fatura em aberto" e aparece em
  "Faturas anteriores" com a situação "Em acordo"; quitada pelo acordo: "Paga (via acordo)".
- Acordo quitado ou cancelado: o cartão some; fica uma linha em "Faturas anteriores" ("Acordo nº {id} · quitado").

## 3. Sino
Os avisos "Acordo de pagamento registrado", "O acordo de pagamento será desfeito em 3 dias", "Acordo de pagamento
desfeito" e "Acordo de pagamento quitado" chegam pelo sino do prompt 49, sem nada novo.

Confira em 1440 e 390 px, claro e escuro.
```
