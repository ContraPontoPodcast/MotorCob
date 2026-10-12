# Site motorcli.online (vitrine do MotorCli)

Projeto **novo e separado** no Hostinger Horizons, só com o site de apresentação do MotorCli. A plataforma
(login, Workspace, Jornada, Mensageria) continua no projeto do motorcob.online; o "Entrar" deste site leva para lá.
Protótipo aprovado: https://claude.ai/artifact/RFpwsGvbDevrHmSUZHUaYE (cópia em `motorcli-site-prototipo.html`).

## Ordem

1. **Horizons › novo projeto** "MotorCli site". Cole o `PROMPT_MOTORCLI_SITE_A.md` e publique.
2. **Integração Supabase** no projeto novo: conecte o MESMO projeto do Supabase da plataforma
   (jxwppkrkuckfwmphqjva). O site usa só a chave pública (anon) e só para gravar o formulário de contato;
   nunca a service_role.
3. Cole o `PROMPT_MOTORCLI_SITE_B.md` e publique.
4. **Domínio:** no projeto novo, conecte `motorcli.online` (Horizons › Domínio › conectar domínio próprio; siga
   as instruções de DNS da tela). Confira `https://motorcli.online` com cadeado.
5. No projeto do **motorcob.online**, cole o `07_workspace/PROMPT_26_LOGIN_FRENTE_PELO_LINK.md` (o login abre
   com o MotorCli escolhido quando vem deste site).
6. Teste: em motorcli.online, mande o formulário de contato e confira no Supabase › Table Editor ›
   `contatos_site` (linha nova com origem `motorcli`). Clique em "Entrar": abre o login da plataforma.

Nada aqui cria tabela nova: o formulário usa a `contatos_site` que já existe (SQL 1).
