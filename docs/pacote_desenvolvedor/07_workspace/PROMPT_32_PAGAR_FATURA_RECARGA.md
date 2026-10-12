# Prompt Horizons — Workspace 32: pagar fatura e recarga (boleto, Pix e cartão), demonstrativo e nota

Rode depois do **SQL 23 e 25** e das funções `cobranca` e `pagamentos-webhook` publicadas (passo 50).
Protótipo aprovado: https://claude.ai/artifact/3aaVmpHLMGL5K2hZSqtqhK (abas "Cliente · pós-pago" e "pré-pago").

```text
EMPRESA › FATURAMENTO do cliente (e da equipe, na empresa aberta). Não mude tabelas nem políticas. Textos e
layout do protótipo "Cobrança MotorCX". Toda chamada à função: supabase.functions.invoke('cobranca', { body }).
Erro: mostre data.erro (já em português) na faixa vermelha da tela, sem derrubar a página.

1. FATURA EM ABERTO (faturas_painel com situacao_atual 'aberta' ou 'vencida', a mais recente primeiro): cartão
   com "Fatura de {mês} · nº {id}", selo "Em aberto · vence dd/mm/aaaa" (amarelo) ou "Vencida" (vermelho),
   "Ciclo de dd/mm/aaaa a dd/mm/aaaa" (rpc ciclo_de) e o valor grande. Abaixo, "Como você quer pagar?" com três
   botões (só as formas de ciclo_empresa.formas; padrão boleto e Pix):
   - Boleto ("Vence junto com a fatura"), Pix ("QR Code vale 24 horas"), Cartão de crédito ("Página segura do
     Stripe").
   Tocar numa forma: invoke({ acao: 'pagar', fatura: id, forma: 'boleto'|'pix'|'cartao' }) → data.cobranca =
   { link, pix_copia_cola, boleto_codigo, expira_em }. Mostre logo abaixo do botão:
   - Boleto: o código (boleto_codigo) com "Copiar código" e o botão "Abrir boleto (PDF)" (link, nova aba).
   - Pix: QR Code desenhado a partir de pix_copia_cola (biblioteca qrcode) + o texto com "Copiar código Pix" e
     "Vale até dd/mm/aaaa às hh:mm" (expira_em).
   - Cartão: "Você vai para a página segura do Stripe. O número do cartão não passa pelo MotorCX." e o botão "Ir
     para o pagamento" (link, mesma aba). Na volta (?pagamento=ok) mostre "Pagamento recebido. A fatura muda
     para Paga em instantes." e recarregue a lista a cada 5 s por 1 minuto.
   Copiar: navigator.clipboard.writeText com fallback de selecionar o texto.

2. DOCUMENTOS DA FATURA (em aberto e anteriores): dois links por fatura:
   - "Demonstrativo (PDF)": invoke({ acao: 'demonstrativo', fatura: id }) → abra data.url em nova aba.
   - "Boleto (PDF)": faturas.boleto_pdf (só se existir), nova aba.
   E a nota fiscal: notas_fiscais da fatura com situacao 'autorizada' → "NFS-e nº {numero}" (link_pdf).

3. FATURAS ANTERIORES: tabela Ciclo · Situação ("Paga em dd/mm · {forma}" verde, de cobrancas pagas) · Valor ·
   Documentos (Demonstrativo, Boleto, NFS-e).

4. PRÉ-PAGO (ciclo_empresa.modelo_pagamento = 'pre'): no lugar da fatura em aberto, o cartão "Saldo" do prompt
   31 continua. O "Recarregar" agora gera o pagamento na hora: depois de rpc('solicitar_recarga', { empresa,
   valor, forma }) (devolve o id), chame invoke({ acao: 'pagar', recarga: id, forma }) e mostre Pix, boleto ou o
   botão do cartão como no item 1. Recarga com Pix pago: "Pagamento confirmado. Saldo atualizado." (a tela lê
   saldo_empresa de novo ao voltar o foco ou a cada 10 s enquanto houver recarga pendente, por 3 minutos).
   Lista "Recargas": Pedida em · Forma (+ " · automática") · Valor · Situação (Paga / Aguardando pagamento /
   Venceu sem pagamento / Cancelada, da última cobranca da recarga) · NFS-e quando houver.

5. RECARGA AUTOMÁTICA (lateral, só com recarga_automatica ligada na contratação): cartões_salvos padrao da
   empresa → bandeira em maiúsculas, "•••• {final}", "Validade {validade}" e o texto "Quando o saldo chega em
   {aviso_saldo}, cobramos {recarga_minima} neste cartão." Sem cartão: "Faça uma recarga com cartão para
   guardar o cartão da recarga automática."

6. DADOS DA COBRANÇA (lateral): CNPJ, e-mail do contato financeiro (empresa_contatos papel financeiro) e formas
   aceitas, com "Para mudar: Empresa › Cadastro e Contatos."

Confira em 1440 e 390px, com o Stripe em modo de teste: pagar uma fatura com Pix (e-mail de teste
succeed_immediately@exemplo.com no contato financeiro) e ver a fatura virar Paga; abrir o demonstrativo em PDF.
```
