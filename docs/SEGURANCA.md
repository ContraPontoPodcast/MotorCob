# Segurança do MotorCob — o que já está no sistema e o que configurar antes do pentest

Referência: OWASP ASVS 4.0 nível 2 (aplicação com dados financeiros de terceiros) e LGPD.

```
motorcob.online (site, só chave anon)  ──login──>  Supabase Auth
          │                                         │
          └── leitura/escrita ──> Postgres com RLS (pode('permissão'), empresa do usuário)
          └── gestão de usuários ──> Edge Function admin-usuarios (service_role só no servidor)
rotina do motor (Mac/nuvem, service_role em arquivo local fora do git)
```

## 1. O que já está no código

| Controle | Onde |
|---|---|
| Isolamento entre empresas: todo dado tem `empresa_id`; usuário só vê a própria empresa | RLS em todas as tabelas (`minhas_empresas()`) |
| Permissões por perfil, padrão MotorCob + ajuste do Admin, **valendo no banco** (não só na tela) | `20261024000001_permissoes_auditoria.sql` (`pode()`, `permissoes_papel`) |
| Travas: Admin nunca perde gerenciar usuários/permissões; ninguém altera o próprio perfil/status; só Admin cria Admin; Admin de empresa não mexe em outra empresa nem na equipe MotorCob | `proteger_perfil`, `validar_permissao_papel`, `regras.ts` |
| Usuário desativado: sem permissão no banco (`pode()` exige ativo) e login bloqueado (ban no Auth) | `pode()`, Edge Function `admin-usuarios` |
| Auditoria de configuração, usuários e permissões (antes/depois, quem, quando); ninguém edita nem apaga pelo site; sem e-mail no histórico | tabela `auditoria`, gatilho `z_auditar` |
| Arquivos: bucket privado por empresa, upload só em pastas conhecidas, download por permissão | políticas do `storage.objects` |
| TRUNCATE/REFERENCES/TRIGGER fechados para o site | fim da migração 20261024 |
| Chave service_role só no servidor (Edge Function: variável de ambiente; motor: arquivo `config/supabase.env` fora do git) | `.gitignore` (`.env`, `*.key`, `*.pem`) |
| Função de usuários: valida entrada (UUID, e-mail, perfil), CORS só para o site, `no-store`, log sem dado pessoal | `supabase/functions/admin-usuarios` |
| Testes automáticos de acesso (214 casos de RLS) + motor + regras da função a cada PR; CodeQL semanal; Dependabot | `.github/workflows` |
| Arquivos exportados sem dado pessoal desnecessário; `{nome}` e `{link}` ficam para a ferramenta do canal | motor (`montar_mensagem`) |

## 2. Configurar no painel do Supabase (antes do pentest)

**Authentication › Providers › Email**
- [ ] Desligar **Allow new users to sign up** (só entra quem for convidado pelo Admin).
- [ ] Ligar **Confirm email** e **Secure email change**.
- [ ] **Password requirements**: **Minimum password length = 12** e **Password requirements = Letters and digits**
      (12+ caracteres, letra e número). É a regra única aprovada, a mesma que as telas do site mostram e a mesma do
      `docs/pacote_desenvolvedor/02_supabase_painel/CONFIGURAR_SUPABASE.md`.
- [ ] **Leaked password protection** ligado (bloqueia senhas vazadas — HaveIBeenPwned; plano Pro).

**Authentication › Multi-Factor**
- [ ] Habilitar **TOTP** (app autenticador). O site exige MFA para o perfil Admin (prompt do site).

**Authentication › URL Configuration**
- [ ] Site URL: `https://motorcob.online`.
- [ ] Redirect URLs: só `https://motorcob.online/**` (apagar `localhost` e curingas abertos).

**Authentication › Rate Limits / Attack Protection**
- [ ] Revisar limites de e-mail, login e verificação (padrão é razoável; reduzir envio de e-mail por hora).
- [ ] Ligar **CAPTCHA** (Cloudflare Turnstile ou hCaptcha) no login e no "esqueci a senha".

**Authentication › Sessions**
- [ ] Tempo de inatividade (ex.: 8 h) e duração máxima da sessão (ex.: 7 dias); JWT expiry 3600 s.

**Authentication › SMTP**
- [ ] SMTP próprio (domínio motorcob.online com SPF, DKIM e DMARC) — o SMTP padrão do Supabase tem limite baixo e
      cai em spam.

**Edge Functions › Secrets** (para `admin-usuarios`)
- [ ] `SITE_URL=https://motorcob.online` e `ORIGENS_PERMITIDAS=https://motorcob.online`
      (`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já existem por padrão).

**Storage**
- [ ] Buckets `entradas` e `saidas` **privados** (sem "Public bucket").
- [ ] `entradas` › Edit bucket: **Restrict file size** um pouco acima da maior base esperada (ex.: 500 MB) e
      **Allowed MIME types** `text/csv, text/plain, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/zip`.

**Database / Project**
- [ ] **Advisors › Security**: zerar os avisos (RLS desligado, funções com search_path mutável, etc.).
- [ ] **API › Exposed schemas**: só `public` (e `storage`).
- [ ] **Network restrictions**: liberar o banco direto (porta 5432/6543) só para quem conecta no Postgres. Hoje são
      as **VMs de voz** no acesso próprio (papel `motorcx_voz` pelo pooler/Supavisor): `35.198.40.10/32` (motorcx-ast-1)
      e `34.39.217.31/32` (motorcx-ast-2) (`infra/asterisk/README.md`, seção do acesso próprio). O **motor não entra
      aqui**: ele usa só a API REST do Supabase (HTTPS), que não passa por essa restrição. Confira no painel se a
      restrição vale também para o pooler; se não valer, a proteção do pooler é a senha forte do `motorcx_voz` e o
      TLS verificado.
- [ ] **SSL enforcement** ligado.
- [ ] Backups: plano pago com backup diário; **PITR** se o contrato exigir RPO baixo. Testar uma restauração.
- [ ] Contas da organização Supabase com MFA; mínimo de membros com papel Owner.

## 3. Site (motorcob.online)

- [ ] Só a chave **anon** no site. Conferir no bundle publicado que não existe `service_role` (busca por
      `service_role` e por JWT com `"role":"service_role"`).
- [ ] Cabeçalhos de segurança no **Netlify** (o site é hospedado lá; nada a configurar no painel):
  - `site/netlify.toml` › `[[headers]]` de `/*`: `Strict-Transport-Security: max-age=31536000; includeSubDomains`,
    `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e
    `Permissions-Policy` (câmera, microfone, localização, pagamento e USB desligados).
  - `Content-Security-Policy`: gerada a cada build por `site/scripts/cabecalhos.mjs` em `build/client/_headers`
    (o Netlify aplica junto com o `netlify.toml`), com o hash SHA-256 dos scripts inline do `index.html` (sem
    `'unsafe-inline'` em `script-src`). Origens: o próprio site, o Supabase do projeto (https e wss),
    `storage.googleapis.com` (gravação e transcrição por URL assinada), `data:`/`blob:` em imagem, áudio e worker;
    `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. Origem nova no site
    (outro domínio de API, fonte externa, CAPTCHA) precisa entrar no `cabecalhos.mjs`, senão o navegador bloqueia.
  - Conferir no ar: `curl -sI https://motorcob.online | grep -i -E 'strict-transport|content-security|x-frame'`.
    Local: `npm run build && npm run preview` serve com os mesmos cabeçalhos.
- [ ] Menus e botões escondidos por `minhas_permissoes()` — mas a proteção real é o banco (o pentest vai chamar a
      API direto; é isso que os testes de RLS cobrem).
- [ ] Sair do sistema limpa a sessão (`supabase.auth.signOut()`), e a tela de login não diz se o e-mail existe.

## 4. Motor e servidor

- [ ] `config/supabase.env` com permissão `600` e fora de qualquer pasta sincronizada (Drive, iCloud).
- [ ] Disco do Mac/servidor criptografado (FileVault / disco criptografado na nuvem).
- [ ] Na nuvem: chave service_role no Secret Manager, VM sem porta aberta além do necessário (o motor só faz
      chamadas de saída), atualizações automáticas, acesso por IAP/SSH com chave.
- [ ] Rotacionar a chave service_role se ela tiver aparecido em qualquer lugar fora do servidor
      (Settings › API › Roll).

## 5. GitHub

- [ ] Settings › Code security: **Secret scanning** e **Push protection** ligados; **Dependabot alerts** ligados.
- [ ] Branch `main` protegida: PR obrigatório e checks `testes` e `codeql` passando.
- [ ] MFA obrigatório na organização.

## 6. Plano do pentest

**Escopo:** `https://motorcob.online`, a API do projeto Supabase (`https://<projeto>.supabase.co/rest/v1`,
`/auth/v1`, `/storage/v1`, `/functions/v1/admin-usuarios`). Fora do escopo: infraestrutura do Supabase e da
Netlify (seguem os programas deles).

**Ambiente:** de preferência um **projeto Supabase de homologação** com as mesmas migrações e dados fictícios
(nunca dado real de devedor — LGPD). Entregar ao time de pentest: 2 empresas (A e B) e um usuário de cada perfil
em cada empresa, mais um usuário desativado.

**Casos que o time deve tentar (e o que esperamos):**
1. Usuário da empresa A ler/alterar dados ou arquivos da B direto pela API (trocar `empresa_id`, caminho no
   Storage) → negado.
2. Operação alterar estratégia, credor, frase, permissão ou perfil chamando a API direto → negado.
3. Usuário se promover a Admin, se reativar, mudar a própria empresa ou virar equipe → negado.
4. Admin da empresa tirar de si o gerenciamento de usuários, mexer em usuário de outra empresa ou da equipe → negado.
5. Usuário desativado com token antigo → sem acesso a dados (`pode()` falso) e sem renovar sessão (ban).
6. Apagar ou forjar registros da auditoria → negado.
7. Edge Function: sem token, token de outra empresa, origem diferente, corpo malformado/injeção → 401/403/400.
8. Upload em pasta não prevista, arquivo gigante, nome com `../` → negado.
9. Enumeração de e-mails no login e no "esqueci a senha" → mesma resposta para e-mail existente ou não.
10. Força bruta de senha → rate limit/captcha.
11. XSS armazenado em campos de texto (nome de credor, frase, nome de estratégia) → texto escapado na tela.
12. Chave service_role ou segredos no bundle do site → ausentes.

**Depois do pentest:** cada achado vira issue com severidade (CVSS), correção com teste de regressão em
`supabase/testes/testar_rls.py` ou `tests/`, e reteste.
