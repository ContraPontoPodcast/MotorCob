# Integrações reais: Stripe, nota fiscal e fornecedores da Mensageria

Tudo já está programado e testado. Falta só ligar com as credenciais de cada conta.
**Nenhuma credencial passa pelo chat, pelo site ou pelo repositório**: cada uma vai direto no cofre certo
(Secrets do Supabase ou Secret Manager do Google Cloud), digitada por você.

Projeto Supabase: `jxwppkrkuckfwmphqjva` · endereço das funções: `https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/`

---

## 0. Banco (uma vez)

Supabase › SQL Editor, na ordem, depois do SQL 22:

1. `01_banco/23_cobranca_stripe_nf.sql`: cobranças, cartão guardado, nota fiscal.
2. `01_banco/24_retorno_fornecedores.sql`: avisos de entrega e resposta dos fornecedores.
3. `01_banco/25_emissao_envio_faturas.sql`: emissão em lote e automática, demonstrativo em PDF e envio por e-mail.

Confira com `CONFERENCIA_GERAL.sql` (itens 29, 30 e 31).

## 1. Stripe (boleto, Pix e cartão)

O Stripe recebe; ele **não emite nota fiscal no Brasil** (a nota sai pelo Focus NFe, passo 2).

1. **Formas de pagamento**: Stripe › Configurações › Métodos de pagamento: ligue **Cartão** e **Boleto**.
   O **Pix** no Stripe Brasil é por convite: peça ao suporte do Stripe para liberar na sua conta.
2. **Comece em modo de teste** (chave `sk_test_...`). Troque pela de produção (`sk_live_...`) só depois de testar.
3. **Chave**: Stripe › Desenvolvedores › Chaves de API › copie a chave secreta. No Supabase › Edge Functions ›
   **Secrets** › Add new secret: nome `STRIPE_SECRET_KEY`, valor = a chave. Salve.
4. **Publicar as funções** (Supabase › Edge Functions › Deploy a new function › Via Editor; para cada uma: nome,
   apague o exemplo, cole o arquivo inteiro, **desligue "Verify JWT"** em Settings, Deploy):
   - `cobranca` ← `MotorCob_funcao_cobranca.ts`
   - `pagamentos-webhook` ← `MotorCob_funcao_pagamentos-webhook.ts`
5. **Aviso de pagamento (webhook)**: Stripe › Desenvolvedores › Webhooks › Adicionar destino:
   - URL: `https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/pagamentos-webhook/stripe`
   - Eventos: `payment_intent.succeeded`, `payment_intent.payment_failed`, `checkout.session.completed`,
     `checkout.session.expired`
   - Depois de criar, copie o **segredo de assinatura** (`whsec_...`) e guarde no Supabase › Secrets como
     `STRIPE_WEBHOOK_SECRET`.
6. **Visual do boleto e da página do cartão**: Stripe › Configurações › Marca: logo e cor do MotorCX.

Cadastro que o cliente precisa ter (senão a tela avisa o que falta): **CNPJ, endereço com CEP e o e-mail do
contato financeiro** (Empresa › Cadastro e Contatos).

Custos do Stripe Brasil (stripe.com/br/pricing, conferido em 12/10/2026): cartão nacional 3,99% + R$ 0,39 · boleto
R$ 3,45 por boleto pago · Pix 1,19% (convite). Boleto: de R$ 5,00 a R$ 49.999,99; confirmação em até 1 dia útil.

## 2. Nota fiscal de serviço (Focus NFe, NFS-e nacional)

1. Crie a conta no Focus NFe e cadastre a empresa MotorCX com o **certificado digital A1** (e a senha dele).
   Comece no ambiente de **homologação** (teste).
2. Copie o **token** da empresa no painel do Focus e guarde no Supabase › Secrets como `FOCUSNFE_TOKEN`.
3. Crie um valor secreto qualquer (no Cloud Shell: `openssl rand -hex 24`) e guarde no Supabase › Secrets como
   `FOCUSNFE_WEBHOOK_TOKEN`.
4. No Focus, crie o **gatilho** (webhook) do evento `nfsen` com a URL
   `https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/pagamentos-webhook/focusnfe` e, no campo
   **authorization**, o mesmo valor do passo 3. (Se o painel não tiver a tela de gatilhos, peça ao suporte do
   Focus para cadastrar com esses dois dados.)
5. **Dados fiscais com o contador**: Console › Faturamento › Nota fiscal (tela nova, depois do prompt do Horizons):
   CNPJ do prestador (só números), inscrição municipal, municípios (código IBGE), código de tributação nacional do
   ISS (6 dígitos), opção do Simples, regime especial, alíquota e as descrições. Deixe em **Homologação** e
   **Emitir nota: Sim** para testar; passe para **Produção** quando o contador aprovar a primeira nota de teste.

A nota sai sozinha: da fatura, quando o pagamento cai (ou na emissão da fatura, se escolher); da recarga, quando
ela é paga. Nota com erro aparece no Console com o motivo e o botão "Emitir de novo".

## 2b. Envio das faturas por e-mail (demonstrativo e boleto)

Emitida a fatura (uma a uma, em lote ou automática), o motor pede à função `cobranca` para gerar o demonstrativo em
PDF, o boleto (PDF do Stripe, separado) e mandar o e-mail aos contatos financeiros da empresa (papel "Financeiro" em
Empresa › Contatos; sem nenhum, vai para os outros contatos).

1. O e-mail sai pela **Locaweb** (a mesma conta do e-mail da Mensageria). No Supabase › Secrets: `LOCAWEB_TOKEN`
   (token do SMTP Locaweb) e `FATURA_EMAIL_DE` (remetente confirmado na Locaweb, ex.: `financeiro@seudominio.com.br`).
2. Os dados do prestador que aparecem no demonstrativo (razão social, CNPJ, endereço) ficam em Console › Faturamento ›
   Configuração da nota (os mesmos da nota fiscal).
3. O e-mail leva o link seguro do demonstrativo (vale 30 dias) e o do boleto. Se a Locaweb confirmar que a API aceita
   anexo, dá para mandar o PDF anexado também; peça essa confirmação ao suporte deles.
4. Para testar: deixe uma empresa com "Emissão automática" ou emita uma fatura em rascunho pelo Console; em até 1
   minuto o envio aparece como "E-mail enviado".

## 3. Fornecedores da Mensageria

Os adaptadores de **Zenvia (SMS e RCS), Infobip (SMS, RCS e consulta de operadora), Sinch (SMS) e Locaweb
(e-mail)** estão prontos. Cada um só liga quando a credencial dele estiver no servidor; sem ela, a reserva assume
como hoje. **Ótima**: não tem documentação pública da API. Peça à Ótima a documentação (envio, retorno de entrega e
respostas) para o adaptador ser feito.

1. **Token do retorno**: no Cloud Shell, `openssl rand -hex 24`. Guarde o valor:
   - no Supabase › Secrets como `RETORNO_TOKEN`;
   - e na lista do passo 3 abaixo.
2. **Publicar a função** `retorno-mensageria` ← `MotorCob_funcao_retorno-mensageria.ts` (Verify JWT **desligado**).
3. **Credenciais no Google Cloud**: Cloud Shell › abra o editor (`nano forn.env`), escreva só as linhas dos
   fornecedores que você tem, uma por linha, sem espaços, salve e rode os comandos abaixo:

```text
RETORNO_URL=https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/retorno-mensageria
RETORNO_TOKEN=<o valor do passo 1>
ZENVIA_TOKEN=<token da API Zenvia>
ZENVIA_SMS_FROM=<remetente/alias do SMS na Zenvia>
ZENVIA_RCS_FROM=<id do agente RCS na Zenvia>
INFOBIP_BASE_URL=<https://xxxxx.api.infobip.com, o endereço da sua conta>
INFOBIP_API_KEY=<chave da API Infobip>
INFOBIP_SMS_FROM=<remetente SMS cadastrado na Infobip>
INFOBIP_RCS_FROM=<agente RCS na Infobip>
SINCH_SERVICE_PLAN_ID=<service plan id>
SINCH_API_TOKEN=<token da API Sinch>
SINCH_FROM=<número ou remetente Sinch>
LOCAWEB_TOKEN=<token do SMTP Locaweb>
LOCAWEB_FROM=<remetente confirmado, ex.: avisos@seudominio.com.br>
```

```bash
gcloud secrets create motorcob-fornecedores --data-file=forn.env
gcloud secrets add-iam-policy-binding motorcob-fornecedores \
  --member="serviceAccount:motorcob-vm@$(gcloud config get-value project).iam.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor
rm forn.env
```

   Para trocar depois: `gcloud secrets versions add motorcob-fornecedores --data-file=forn.env`.
4. **Script de início da máquina** (passou a ler esse segredo): Cloud Shell › ⋮ › Fazer upload › `vm_inicio.sh`
   desta versão, e:

```bash
gcloud compute instances add-metadata motorcob --zone=southamerica-east1-a \
  --metadata-from-file=startup-script=vm_inicio.sh
gcloud compute instances reset motorcob --zone=southamerica-east1-a
```

5. **Retorno em cada painel** (o endereço base é
   `https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/retorno-mensageria/<fornecedor>?t=<RETORNO_TOKEN>`):
   - **Zenvia**: nada a fazer; o motor cadastra sozinho (uma vez por dia confere).
   - **Infobip**: entrega já vai em cada envio. Para receber as **respostas**, no painel da Infobip configure o
     encaminhamento das mensagens recebidas do seu número para `.../retorno-mensageria/infobip?t=...`.
   - **Sinch**: entrega já vai em cada envio. Para as **respostas**, peça ao gerente da conta para cadastrar
     `.../retorno-mensageria/sinch?t=...` como URL de mensagens recebidas do service plan.
   - **Locaweb**: painel SMTP › Configurações › Webhook: `.../retorno-mensageria/locaweb?t=...` (bounce e abertura).
6. **Ligar o envio real** por empresa: Console › Mensageria da empresa › Configurações › Envio real (como já é hoje).
   Antes, faça um teste com um lote pequeno para números da própria equipe.

O que muda no envio real: SMS e RCS saem como **Disparado** e mudam para **Enviado**, **Entregue** ou **Não
entregue** quando a operadora avisa (segundos a minutos). Resposta do cliente entra no Radar e no atendimento; "SAIR"
vira descadastro. No e-mail, bounce corrige o "entregue" e abertura conta no funil.

## Onde fica cada credencial

| Credencial | Onde | Quem usa |
|---|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Supabase › Edge Functions › Secrets | cobranca, pagamentos-webhook |
| `FOCUSNFE_TOKEN`, `FOCUSNFE_WEBHOOK_TOKEN` | Supabase › Edge Functions › Secrets | cobranca, pagamentos-webhook |
| `RETORNO_TOKEN` | Supabase › Secrets **e** segredo `motorcob-fornecedores` | retorno-mensageria e motor |
| `LOCAWEB_TOKEN`, `FATURA_EMAIL_DE` | Supabase › Edge Functions › Secrets | cobranca (e-mail das faturas) |
| Zenvia, Infobip, Sinch, Locaweb | Google Cloud › Secret Manager › `motorcob-fornecedores` | motor (envio) |
