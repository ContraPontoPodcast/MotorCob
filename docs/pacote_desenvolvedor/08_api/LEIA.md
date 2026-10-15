# API das cargas — como publicar

> Revisão de 15/10/2026: depois do SQL 41, publique a função `api` de novo e cole o prompt 63 (a tela sai de Minha
> conta e vai para Empresa › Integrações). Domínio api.motorcob.online: `DOMINIO_API.md`.

Ordem (uma vez):

1. **SQL 8** — `08_api_tokens.sql` (mesmo conteúdo de `supabase/migrations/20261105000001_api_tokens.sql`):
   tabela de tokens (só o hash), `criar_token_api`, `revogar_token_api`, limite por minuto e a permissão
   **`gerenciar_api`** (padrão: só Admin). Pode rodar mais de uma vez.
2. **Função `api`** — Supabase › Edge Functions › **Deploy a new function** › **Via Editor** › nome **`api`** ›
   apague o exemplo e cole `MotorCob_funcao_api.ts` › em **Settings** da função, **desligue "Verify JWT"**
   (o token da API é do MotorCob, não é login do Supabase; a função confere tudo sozinha) › **Deploy**.
   Endereço da API: `https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/api/v1/...`
3. **Função `admin-usuarios`** — cole a versão nova (`05_usuarios_permissoes_seguranca/MotorCob_funcao_admin-usuarios.ts`)
   e faça Deploy (ela passa a conhecer a permissão `gerenciar_api`).
4. **Prompt 19** (`PROMPT_TOKENS_API.md`) no Horizons: tela de tokens em Minha conta, página /docs/api e o aviso
   novo em Credores.
5. Para cada empresa que vai usar: Console › Empresa › Módulos › ligue **API**; em Credores, escolha **API** em
   "Como a carga chega".

Nada de chave nova: a função usa as variáveis que o Supabase já dá a toda Edge Function (`SUPABASE_URL` e
`SUPABASE_SERVICE_ROLE_KEY`). Nunca cole a chave service_role no site, no chat ou no código.

Teste rápido depois de publicar (troque o token e o credor):

    curl -X POST "https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/api/v1/cargas?credor=banco-x&tipo=incremental&nome=teste.csv" \
         -H "Authorization: Bearer mc_SEU_TOKEN" -H "Content-Type: text/csv" --data-binary @teste.csv

A resposta traz `envio_id`; em até um minuto o motor processa e `GET /v1/cargas/{envio_id}` mostra o relatório.
