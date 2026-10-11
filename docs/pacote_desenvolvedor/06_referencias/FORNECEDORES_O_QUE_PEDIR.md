# O que pedir a cada fornecedor de mensageria

Para ligar o envio de verdade, cada fornecedor (SMS: Ótima, Zenvia, Infobip, Sinch; e-mail: Locaweb) precisa
entregar o que está abaixo. Peça por escrito, no contrato ou no e-mail de boas-vindas.

## Para todos
1. **Acesso de API em produção** e, se houver, um **ambiente de testes** (sandbox) com números de teste.
2. **Documentação da API**: envio individual e em lote, limite de envios por segundo e tamanho máximo do lote.
3. **Tipo de credencial** (token, usuário e senha, chave + segredo) e **como renovar**. A credencial NÃO vem por
   chat nem por e-mail para a equipe: ela é cadastrada direto no cofre de segredos do Google Cloud por quem tem
   acesso ao projeto (passo a passo no guia da nuvem).
4. **Retorno de status por webhook** (entregue, não entregue, lido quando houver) com: formato do aviso, como
   validar que veio mesmo do fornecedor (assinatura ou IP fixo) e quantas vezes ele tenta de novo se falhar.
5. **Lista de IPs de saída** do fornecedor (para liberar o webhook) e **IP fixo** que eles exigem do nosso lado,
   se exigirem.
6. **Preço por mensagem** e faixas por volume, **franquia mínima** e se cobram mensagem **não entregue**.
7. **Contato técnico** e prazo de suporte em caso de queda (acordo de nível de serviço).

## SMS
- **Remetente**: número curto (shortcode) dedicado ou compartilhado, ou número longo; custo e prazo de liberação.
- **Respostas do cliente** (ex.: "SAIR"): chegam por webhook? Em quanto tempo?
- **Limite de caracteres** por mensagem e como cobram mensagem concatenada (acima de 160).
- **Regras de horário e conteúdo** que eles aplicam para cobrança (bloqueios, palavras proibidas).

## E-mail (Locaweb)
- **Domínio de envio** dedicado (ex.: `envio.suaempresa.com.br`) e os registros DNS que eles pedem: **SPF**,
  **DKIM** e **DMARC**.
- **Envio por API ou por SMTP** (preferimos API) e limite por hora/dia.
- **Retorno** de entregue, rejeitado (bounce), marcado como spam e descadastro, por webhook.
- **Link de descadastro** automático no rodapé (obrigatório) e **lista de supressão** compartilhada.

## Quando chegar
Me avise qual fornecedor está liberado (sem mandar a credencial). Eu ligo o adaptador dele e testamos primeiro no
ambiente de testes, com números e e-mails de teste, antes de qualquer envio real.
