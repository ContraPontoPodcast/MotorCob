# E-mails do sistema — caixa da Hostinger, domínio, Secrets e modelos do login

Aprovado em 16/10/2026 (`docs/homologacao/emails-sistema-prototipo.html`). Rode **antes** de publicar as funções
`emails`, `cobranca` e `relatorios` novas (SQL 42 primeiro). Nenhuma senha ou token passa pelo chat: tudo é digitado
por você no painel de cada serviço.

| Remetente | Usado em | Responder vai para |
|---|---|---|
| `MotorCX <acesso@motorcob.online>` | convite, redefinir senha, senha alterada, verificação em duas etapas removida (Supabase Auth) | suporte |
| `MotorCX Financeiro <financeiro@motorcob.online>` | fatura, lembretes, acordo, parcela, bloqueio e liberação | o próprio financeiro@ (precisa ser uma caixa que alguém lê) |
| `MotorCX <avisos@motorcob.online>` | avisos do sino que viram e-mail | suporte |
| `MotorCX Relatórios <relatorios@motorcob.online>` | relatório agendado | suporte |

**Configuração adotada em 23/10/2026:** um remetente só para todas as frentes, `sistema@motorcx.online` (domínio
motorcx.online, DKIM `hostingermail-a` ativo). Os Secrets `EMAIL_DE_ACESSO`, `EMAIL_DE_FINANCEIRO`, `EMAIL_DE_AVISOS`
e `EMAIL_DE_RELATORIOS` recebem esse endereço, o Sender email do passo 5 também, e o domínio do Console é
`motorcx.online`. O nome mostrado continua por tipo (MotorCX, MotorCX Financeiro, MotorCX Relatórios), e as respostas
de todas as frentes caem em `sistema@`. A tabela acima vale para quem quiser um endereço por frente.

Os e-mails do sistema (relacionamento com quem usa a plataforma) saem pela **caixa padrão da Hostinger**, por SMTP.
A **Locaweb fica só para os envios em massa da Mensageria** (campanhas): uma reclamação de spam numa campanha não pode
levar a fatura ou o "Esqueci a senha" para o spam.

## 1. Caixa padrão na Hostinger (hPanel › E-mails)
- [ ] Use a caixa padrão do domínio (ex.: `sistema@motorcob.online`) ou crie uma. Anote o endereço; a senha você
      digita direto no passo 3, ela não passa pelo chat nem pelo git.
- [ ] Crie `acesso@`, `financeiro@`, `avisos@` e `relatorios@` como **apelidos (aliases)** dessa caixa. Assim tudo sai
      pelo mesmo login e as devoluções e respostas caem na mesma caixa. `financeiro@` precisa ser lida por alguém.
- Se algum remetente precisar ser uma caixa própria (com senha própria), use os Secrets opcionais do passo 3.
- Limite: confira no plano da Hostinger quantos e-mails por dia a caixa manda; os do sistema são poucos (faturas,
  relatórios, avisos), mas um lote grande de faturas no mesmo dia conta.

## 2. DNS de motorcob.online (hPanel › Domínios › DNS)
- [ ] **SPF**: um único TXT `v=spf1 include:_spf.mail.hostinger.com ~all` (já está assim). Quando a Mensageria
      mandar e-mail pela Locaweb **com este mesmo domínio**, o `include` da Locaweb entra no **mesmo** registro (dois
      registros `v=spf1` invalidam os dois).
- [ ] **DKIM**: em hPanel › E-mails › (caixa) › Configurações do DNS, ative o DKIM. A Hostinger cria os registros
      `hostingermail-a._domainkey` (a chave em uso) e `hostingermail-b._domainkey` (a da próxima troca, vazia por
      enquanto). O seletor para o Console é `hostingermail-a`.
- [ ] **DMARC**: TXT em `_dmarc.motorcob.online` `v=DMARC1; p=none; rua=mailto:<caixa que recebe os relatórios>`
      (hoje está só `v=DMARC1; p=none`). Depois de 2 a 4 semanas sem falha no Console, troque para `p=quarantine`.
- O motor confere SPF, DKIM e DMARC uma vez por dia e o Console mostra o resultado.

## 3. Supabase › Edge Functions › Secrets
- [ ] `EMAIL_SMTP_USUARIO` — o endereço da caixa do passo 1.
- [ ] `EMAIL_SMTP_SENHA` — a senha dessa caixa (digitada por você só aqui).
- [ ] `EMAIL_LINK_SEGREDO` — 32 ou mais caracteres aleatórios (gerenciador de senhas). Assina o link "Não quero mais
      estes e-mails"; trocar invalida os links dos e-mails já enviados.
- [ ] Já existentes: `SITE_URL=https://motorcob.online` e `ORIGENS_PERMITIDAS=https://motorcob.online`.
- Opcionais: `EMAIL_SMTP_HOST` (padrão `smtp.hostinger.com`) e `EMAIL_SMTP_PORTA` (padrão `465`; as Edge Functions
  bloqueiam 25 e 587). `EMAIL_DE_ACESSO`, `EMAIL_DE_FINANCEIRO`, `EMAIL_DE_AVISOS`, `EMAIL_DE_RELATORIOS` (endereço
  completo, se algum remetente for diferente de `tipo@motorcob.online`). `EMAIL_SMTP_USUARIO_FINANCEIRO` +
  `EMAIL_SMTP_SENHA_FINANCEIRO` (idem `_ACESSO`, `_AVISOS`, `_RELATORIOS`) quando aquele remetente for uma caixa
  própria. `FATURA_EMAIL_DE` e `RELATORIO_EMAIL_DE` ainda valem, cada um só para o seu tipo.
- `EMAIL_SISTEMA_TOKEN` e `EMAIL_RETORNO_TOKEN` não são mais usados (eram da Locaweb). O `LOCAWEB_TOKEN` continua,
  só para a Mensageria.

## 4. Funções (depois do passo 3: as versões novas exigem `EMAIL_SMTP_USUARIO` e `EMAIL_SMTP_SENHA`)
- [ ] Publicar **`emails`** com **Verify JWT DESLIGADO** (o link de sair não tem login):
      `python3 scripts/juntar_funcao.py emails`.
- [ ] Publicar de novo `cobranca` e `relatorios` (faturas e relatórios passam a sair pela Hostinger).
- Até republicar, as versões no ar continuam mandando faturas e relatórios como hoje.

## 5. Login (Supabase Auth) pela mesma caixa, em português
**Authentication › Emails › SMTP Settings** (Enable custom SMTP):
- [ ] Host `smtp.hostinger.com`, porta `465`, usuário = a caixa do passo 1, senha = a dela (digitados por você).
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

## Devoluções
Sem webhook: o envelope é a caixa do passo 1, então e-mail que volta (endereço inexistente, caixa cheia) chega nela
como aviso de não entrega. Confira essa caixa toda semana e corrija o contato em Empresa › Contatos. Marcar "E-mail
voltou" sozinho (o motor lendo a caixa por IMAP) fica para uma fase 2.
