# E-mails do sistema — conta de envio, domínio, Secrets e modelos do login

Aprovado em 16/10/2026 (`docs/homologacao/emails-sistema-prototipo.html`). Rode **antes** de publicar as funções
`emails`, `cobranca` e `relatorios` novas (SQL 42 primeiro). Nenhuma senha ou token passa pelo chat: tudo é digitado
por você no painel de cada serviço.

| Remetente | Usado em | Responder vai para |
|---|---|---|
| `MotorCX <acesso@motorcob.online>` | convite, redefinir senha, senha alterada, verificação em duas etapas removida (Supabase Auth) | suporte |
| `MotorCX Financeiro <financeiro@motorcob.online>` | fatura, lembretes, acordo, parcela, bloqueio e liberação | o próprio financeiro@ (precisa ser uma caixa que alguém lê) |
| `MotorCX <avisos@motorcob.online>` | avisos do sino que viram e-mail | suporte |
| `MotorCX Relatórios <relatorios@motorcob.online>` | relatório agendado | suporte |

## 1. Conta de envio do sistema (separada da Mensageria)
- [ ] Na Locaweb, crie uma **conta de SMTP separada** da que manda as campanhas da Mensageria (uma reclamação de
      spam numa campanha não pode levar a fatura para o spam).
- [ ] Cadastre e valide os 4 remetentes acima nessa conta.
- [ ] Gere o token da API dessa conta. Ele vai **só** para o Secret `EMAIL_SISTEMA_TOKEN` (passo 3).
- [ ] Em Configurações › Webhook dessa conta: endereço
      `https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/emails/retorno?t=<EMAIL_RETORNO_TOKEN>`, com
      devoluções (bounce) e aberturas ligadas. É o que marca "E-mail voltou" em Empresa › Contatos.
- O `LOCAWEB_TOKEN` atual continua só para a Mensageria.

## 2. DNS de motorcob.online (quem administra o DNS)
- [ ] **SPF**: um único registro TXT `v=spf1 ...` no domínio, com o `include` que o painel da Locaweb mostra para a
      conta de envio (e os de quem mais manda e-mail pelo domínio). Dois registros `v=spf1` invalidam os dois.
- [ ] **DKIM**: o registro TXT que o painel da Locaweb gera. Anote o **seletor** (a parte antes de `._domainkey`) e
      preencha em Console › E-mails do sistema › Configurações, para o motor conferir.
- [ ] **DMARC**: TXT em `_dmarc.motorcob.online`, começando por `v=DMARC1; p=none; rua=mailto:<caixa que recebe os
      relatórios>`. Depois de 2 a 4 semanas sem falha no Console, troque para `p=quarantine`.
- O motor confere SPF, DKIM e DMARC uma vez por dia e o Console mostra o resultado.

## 3. Supabase › Edge Functions › Secrets
- [ ] `EMAIL_SISTEMA_TOKEN` — o token da conta do passo 1.
- [ ] `EMAIL_LINK_SEGREDO` — 32 ou mais caracteres aleatórios (gerenciador de senhas). Assina o link "Não quero mais
      estes e-mails"; trocar invalida os links dos e-mails já enviados.
- [ ] `EMAIL_RETORNO_TOKEN` — outros 32 ou mais caracteres aleatórios; o mesmo valor vai no endereço do webhook.
- [ ] Já existentes: `SITE_URL=https://motorcob.online` e `ORIGENS_PERMITIDAS=https://motorcob.online`.
- Opcionais: `EMAIL_DE_ACESSO`, `EMAIL_DE_FINANCEIRO`, `EMAIL_DE_AVISOS`, `EMAIL_DE_RELATORIOS` (endereço completo, se
  algum remetente for diferente do padrão). `FATURA_EMAIL_DE` e `RELATORIO_EMAIL_DE` ainda valem, cada um só para o
  seu tipo; podem ser apagados depois que os novos estiverem no ar.

## 4. Funções
- [ ] Publicar a função nova **`emails`** com **Verify JWT DESLIGADO** (o webhook e o link de sair não têm login):
      `python3 scripts/juntar_funcao.py emails`.
- [ ] Publicar de novo `cobranca`, `relatorios`, `admin-usuarios` e `assistente`.

## 5. Login (Supabase Auth) pela mesma conta, em português
**Authentication › Emails › SMTP Settings** (Enable custom SMTP):
- [ ] Host, porta, usuário e senha do SMTP da conta do passo 1 (digitados por você; não vão para o git nem para o chat).
- [ ] Sender email `acesso@motorcob.online`, Sender name `MotorCX`.

**Authentication › Emails › Templates** — troque `[RODAPÉ]` pelo mesmo texto que estiver em Console › E-mails do
sistema (razão social · CNPJ · endereço):

- [ ] **Invite user** — Assunto: `Você foi convidado para a {{ .Data.empresa_nome }} no MotorCX`
```html
<div style="background:#F2F2F4;padding:18px 12px"><div style="max-width:560px;margin:0 auto;background:#FFFFFF;color:#1D1D1F;border:1px solid #E3E4E8;border-radius:12px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.5">
<div style="padding:14px 22px;border-bottom:1px solid #E3E4E8"><b style="font-size:16px">MotorCX</b></div>
<div style="padding:22px">
<h1 style="margin:0 0 12px;font-size:19px">Você foi convidado para a {{ .Data.empresa_nome }}</h1>
<p>Olá{{ if .Data.nome }}, {{ .Data.nome }}{{ end }}. {{ .Data.convidado_por }} criou o seu acesso como <b>{{ .Data.papel }}</b>. Crie sua senha para entrar.</p>
<p><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#1D1D1F;color:#FFFFFF;text-decoration:none;font-weight:600">Criar minha senha</a></p>
<p style="background:#F5F5F7;border-radius:10px;padding:10px 12px;font-size:13.5px">O link vale 24 horas e funciona uma vez. Se não esperava este convite, ignore: nada acontece.</p>
</div>
<div style="padding:14px 22px;border-top:1px solid #E3E4E8;font-size:12px;color:#6E6E73">Você recebe porque alguém criou um acesso com este e-mail.<br>MotorCX · motorcob.online · [RODAPÉ]</div>
</div></div>
```
- [ ] **Reset password** — Assunto: `Redefinir sua senha do MotorCX`. Mesmo modelo, com:
      título `Redefinir sua senha`; texto `Recebemos um pedido para trocar a senha deste e-mail.`; botão
      `Escolher nova senha` (`{{ .ConfirmationURL }}`); caixa cinza `O link vale 1 hora. Não pediu? Ignore este e-mail:
      sua senha continua a mesma.`; rodapé `A MotorCX nunca pede sua senha por e-mail, telefone ou WhatsApp.`
- [ ] **Security notifications** (ligar no projeto): **Password changed** — Assunto `Sua senha do MotorCX foi
      alterada`; texto `A senha da conta {{ .Email }} foi alterada agora. Se não foi você, use "Esqueci a senha" no
      login e avise o Admin da sua empresa.` **Verification method removed** — Assunto `A verificação em duas etapas
      foi desligada na sua conta`; texto `Um método de verificação ({{ .FactorType }}) foi removido da conta
      {{ .Email }}. Se não foi você, troque a senha e fale com o Admin da sua empresa.` Os dois sem botão de sair
      (são obrigatórios).
- [ ] Validade do link por e-mail: 86400 segundos (24 h), como no passo 5b do `CONFIGURAR_SUPABASE.md`.

## 6. Conferir
- [ ] `CONFERENCIA_GERAL.sql`: item 29 OK.
- [ ] Console › E-mails do sistema: SPF, DKIM e DMARC verdes no dia seguinte; preencha rodapé e e-mails da equipe
      (suporte, comercial, financeiro).
- [ ] "Enviar teste para mim" em cada tipo; confira que chegou na caixa de entrada (não no spam), com o remetente
      certo e o rodapé preenchido.
- [ ] Peça um "Esqueci a senha" num usuário de teste: o e-mail sai de acesso@ e em português.

## O que cada e-mail nunca leva
CPF, nome de devedor, telefone ou valor de carteira. Só o assunto, o essencial e um botão para a plataforma. O
registro (`emails_sistema`) guarda o endereço apenas como hash e de forma mascarada (c***@alfa…).

## Limite conhecido
A API HTTP da Locaweb recebe o corpo em HTML. O modelo foi feito para ler bem também em programas que mostram só texto
(sem imagem, texto curto e um botão). Se a conta passar a aceitar a parte "só texto", ela entra em
`supabase/functions/_compartilhado/email.ts` (a função `textoPlano` já gera o texto).
