# Passo 1 — Configurações no painel do Supabase (antes de mexer no site)

Projeto `jxwppkrkuckfwmphqjva` · supabase.com/dashboard

## 1. URGENTE: fechar o cadastro aberto
Hoje o site tem a página `/cadastro`, que chama `supabase.auth.signUp`. Qualquer pessoa na internet consegue criar
uma conta. Ela não vê dados (o banco bloqueia quem não tem empresa), mas é uma falha que qualquer pentest aponta,
e o acesso deve ser **só por convite**. Tirar a página não basta: a API continua aceitando cadastro.

- [ ] **Authentication › Sign In / Providers › Email** (ou *Auth settings*): desligar **"Allow new users to sign up"**.
      Convite pelo Admin continua funcionando (a função `admin-usuarios` usa `inviteUserByEmail`, que não depende disso).
- [ ] Conferir em **Authentication › Users** se apareceram contas que ninguém convidou e desativá-las/apagar.

## 2. URLs de retorno (convite e senha)
- [ ] **Authentication › URL Configuration**
  - Site URL: `https://motorcob.online`
  - Redirect URLs: `https://motorcob.online/**` (apague `localhost` e curingas de outros domínios).

## 3. Verificação em duas etapas (MFA)
- [ ] **Authentication › Multi-Factor**: habilitar **TOTP** (aplicativo autenticador). O site passa a exigir para Admin
      (pasta `05`).

## 4. Senha e proteção de login
- [ ] **Password requirements** (Authentication › Providers › Email): **Minimum password length = 12** e
      **Password requirements = Letters and digits**. É a regra única aprovada no bloco 5 (12+ caracteres, letra e
      número), a mesma que as telas mostram (prompt 45) e a mesma do `docs/SEGURANCA.md` (seção 2).
- [ ] **Leaked password protection** ligado (se o plano permitir).
- [ ] **Attack Protection**: ligar CAPTCHA (Cloudflare Turnstile) no login e no "esqueci a senha" (opcional nesta
      etapa; se ligar, o login do site precisa enviar o token do captcha).

## 5. Edge Function `admin-usuarios` (já publicada)
- [ ] **Edge Functions › Secrets**: existir `SITE_URL=https://motorcob.online` e
      `ORIGENS_PERMITIDAS=https://motorcob.online`.
- Observação: a função manda o convite para `SITE_URL/definir-senha` e o reset para `SITE_URL/redefinir-senha`.
  O site precisa ter essas duas rotas (pasta `05`).

## 5b. E-mail de convite e validade do link (primeiro uso, aprovado em 15/10/2026)
> Modelo do convite atualizado pelos E-mails do sistema (SQL 42): use o de `EMAILS_SISTEMA.md` (passo 5), que também
> traz o SMTP próprio, a redefinição de senha em português e os avisos de segurança.

- [ ] **Authentication › Emails › Invite user**: assunto e corpo abaixo. A função `admin-usuarios` manda
      `empresa_nome`, `papel` e `convidado_por` (e `nome`, quando informado) nos dados do convite.
      - Assunto: `Você foi convidado para a {{ .Data.empresa_nome }} no MotorCX`
      - Corpo (HTML simples):
        ```html
        <p>Olá{{ if .Data.nome }}, {{ .Data.nome }}{{ end }}.</p>
        <p>{{ .Data.convidado_por }} criou o seu acesso à <b>{{ .Data.empresa_nome }}</b> no MotorCX, como
           <b>{{ .Data.papel }}</b>.</p>
        <p>Para entrar, crie sua senha. Leva poucos minutos.</p>
        <p><a href="{{ .ConfirmationURL }}">Criar minha conta</a></p>
        <p style="color:#6E6E73;font-size:13px">O link vale por 24 horas e só funciona uma vez. Se vencer, peça
           outro a quem convidou você. Se não esperava este convite, ignore este e-mail.</p>
        ```
- [ ] **Authentication › validade do link por e-mail** (Email OTP / link expiration): **86400 segundos** (24 h),
      o prazo que o e-mail promete.
- Remetente: o domínio de e-mail do MotorCX (SMTP próprio, se configurado). Nada de remetente pessoal.

## 5c. Edge Function `gravacoes` (agente de voz: ouvir e ler a transcrição)
- [ ] Publicar `supabase/functions/gravacoes` (ou o arquivo único de `python3 scripts/juntar_funcao.py gravacoes`)
      com **Verify JWT ligado**: só quem está logado chama.
- [ ] **Edge Functions › Secrets**: `GCS_GRAVACOES_CHAVE` = o JSON inteiro da chave de uma conta de serviço do GCP
      com só **leitura de objeto** (`roles/storage.objectViewer`) nos buckets de gravação das empresas
      (`voz_config.bucket_gravacoes`). Quem cola o valor é o dono, direto no painel; o valor nunca vai para o
      repositório, para o chat nem para log. `SITE_URL` e `ORIGENS_PERMITIDAS` são os mesmos do item 5.
      A conta é a `motorcx-gravacoes-leitura`, criada pelo `infra/asterisk/criar_gcp.sh` (a leitura em cada bucket
      entra com `bash criar_gcp.sh empresa <id> <dias>`). A chave sai num arquivo temporário do Cloud Shell, sem
      aparecer na tela: `bash criar_gcp.sh chave-leitura` mostra o caminho, como colar aqui e como apagar com `shred -u`.
- Contrato: `POST { gravacao, tipo: "audio" | "transcricao" }` com o login da pessoa.
  `audio` → `{ url, expira_em }` (URL assinada V4, só GET, 5 minutos); `transcricao` → `{ segmentos }`
  (lida pela função; o site nunca recebe o caminho do objeto).
- Quem pode: pessoa ativa do cliente, da empresa da gravação, com `ouvir_gravacoes` (áudio) ou `ver_transcricoes`
  (transcrição). A equipe MotorCX não ouve por aqui. Cada acesso entra em `acessos` (`ouvir_gravacao` ou
  `ler_transcricao`, `alvo` = id da gravação) antes da resposta; sem registro, não há link.
- Respostas de erro: 401 sem login, 403 sem permissão, 404 gravação fora do alcance, 409 transcrição ainda não
  pronta, 410 transcrição já apagada, 503 secret ou bucket ainda não configurado.

## 6. Storage — imagem de compartilhamento do site
Depois de rodar o SQL da pasta `01_banco` (cria o bucket público `site`):
- [ ] **Storage › site › Upload files**: enviar `03_site_e_login/imagens/og-motorcob.jpg` na raiz do bucket.
      URL pública: `https://jxwppkrkuckfwmphqjva.supabase.co/storage/v1/object/public/site/og-motorcob.jpg`
      (o site novo não usa vídeo nem fotos de tela).

## 7. Conferência rápida (SQL Editor)
```sql
select count(*) as contatos from public.contatos_site;            -- existe (0 ou mais)
select id, public from storage.buckets where id = 'site';         -- site | true
select count(*) as funcoes_abertas_ao_anonimo
from information_schema.routine_privileges
where grantee in ('anon', 'PUBLIC') and routine_schema = 'public'; -- 0
```
