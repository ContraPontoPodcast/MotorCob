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
- [ ] **Password requirements**: mínimo 12 caracteres, com maiúscula, minúscula, número e símbolo.
- [ ] **Leaked password protection** ligado (se o plano permitir).
- [ ] **Attack Protection**: ligar CAPTCHA (Cloudflare Turnstile) no login e no "esqueci a senha" (opcional nesta
      etapa; se ligar, o login do site precisa enviar o token do captcha).

## 5. Edge Function `admin-usuarios` (já publicada)
- [ ] **Edge Functions › Secrets**: existir `SITE_URL=https://motorcob.online` e
      `ORIGENS_PERMITIDAS=https://motorcob.online`.
- Observação: a função manda o convite para `SITE_URL/definir-senha` e o reset para `SITE_URL/redefinir-senha`.
  O site precisa ter essas duas rotas (pasta `05`).

## 6. Storage — mídia da página comercial
Depois de rodar o SQL da pasta `01_banco` (cria o bucket público `site`):
- [ ] **Storage › site › Upload files**: enviar os 4 arquivos de `03_site_comercial_e_login/midia_bucket_site/`
      na raiz do bucket. URL pública de cada um:
      `https://jxwppkrkuckfwmphqjva.supabase.co/storage/v1/object/public/site/<arquivo>`

## 7. Conferência rápida (SQL Editor)
```sql
select count(*) as contatos from public.contatos_site;            -- existe (0 ou mais)
select id, public from storage.buckets where id = 'site';         -- site | true
select count(*) as funcoes_abertas_ao_anonimo
from information_schema.routine_privileges
where grantee in ('anon', 'PUBLIC') and routine_schema = 'public'; -- 0
```
