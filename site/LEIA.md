# Site motorcob.online (`site/`)

O site do MotorCX (página comercial, login e todo o app: Workspace, Orquestração, Mensageria, Console…) mora
aqui, neste repositório. **O Horizons (Hostinger) não é mais a fonte da verdade**: o código foi exportado de lá,
limpo do que só servia ao editor e publicado como site estático no Netlify. Mudança no site é commit aqui,
com PR, como o resto do MotorCob. Não edite mais pelo Horizons (o que for feito lá não volta para cá).

A pasta `site/duas-etapas/` é outra coisa (componente de verificação em duas etapas, com teste próprio no
workflow `testes`); ela não entra no build do site. O site usa uma cópia exata dos dois arquivos em
`src/components/` (só a primeira linha muda): mude lá e copie para cá; o CI confere.

## Como funciona

- React Router 8 em **modo SPA** (`ssr: false` em `react-router.config.ts`), Vite 8, Tailwind 3.
- No build, o React Router gera `build/client/index.html` (a casca do app) e os arquivos em `build/client/assets/`.
  Não há servidor: o Netlify serve os arquivos e toda rota que não é arquivo abre o `index.html`
  (redirect `/* /index.html 200`); o roteamento acontece no navegador.
- Dados: só Supabase, direto do navegador, com a chave **anon** e a sessão de quem está logado. Quem protege os
  dados é a RLS do banco (`supabase/migrations/`), nunca o site.
- Formulário "Fale com a gente" da home: grava em `public.contatos_site` (SQL 29 + SQL 52). O visitante só
  insere; o Console › Contatos do site lê com a sessão do Master da equipe.
- `public/robots.txt` e `public/sitemap.xml` são arquivos fixos (antes eram rotas do servidor). Página pública
  nova que deve ir para o Google: acrescente no `sitemap.xml`.
- Canonical e `og:url` usam `https://motorcob.online` (`src/lib/seo.ts`; troque com `VITE_SITE_ORIGIN`).
- `www.motorcob.online` → `motorcob.online` (301) no `netlify.toml`; o componente `CanonicalDomain` do
  `root.tsx` faz o mesmo no navegador, por garantia.

## Rodar no computador

Precisa de Node 22 (`.nvmrc`) e npm.

```sh
cd site
cp .env.example .env        # e cole a chave anon (a mesma do netlify.toml)
npm ci                      # instala exatamente o package-lock.json
npm run dev                 # http://localhost:3000 (com recarga automática)
```

Para ver o build como no Netlify:

```sh
npm run build               # gera build/client
npm run preview             # serve build/client em http://127.0.0.1:4173 com o fallback do SPA
```

Outros comandos: `npm run lint` (oxlint), `npm run typecheck` (tsc; tem de dar zero erro, o CI barra) e `npm test`
(as regras do Fluxo do agente em `site/fluxo/` e os componentes `src/**/*.test.tsx`, como os do design system em
`src/components/ds/` e os do Fluxo do agente em `src/components/fluxo/`; a API do DS está documentada no `index.ts` de lá).

Modo de demonstração do Fluxo do agente (só desenvolvimento): `VITE_FLUXO_FIXTURES=1 npm run dev` cria a rota
`/dev/fluxo/<tela>` (lista, editor/105, testar, desempenho, pedido/412, personas, conectores) com dados fictícios, sem
login nem banco, para ver e fotografar as telas. Sem a variável a rota não existe, e o build de produção nunca a inclui.

## Variáveis de ambiente

Todas são públicas (começam com `VITE_` e vão para o JavaScript do navegador). Nenhum segredo entra no site.

| Variável | Para quê | Onde está |
|---|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase | `netlify.toml` › `[build.environment]` |
| `VITE_SUPABASE_ANON_KEY` | chave anon (papel `anon`; a RLS limita o que ela faz) | `netlify.toml` › `[build.environment]` |
| `VITE_SITE_ORIGIN` | origem do canonical/`og:url` (padrão `https://motorcob.online`) | `netlify.toml` (opcional) |

- **Nunca** coloque a chave `service_role` no site, no `.env`, no `netlify.toml` nem no painel do Netlify. Ela
  só existe no servidor do motor e nas Edge Functions.
- O `.env` não vai para o git (está no `.gitignore`); o modelo é o `.env.example`.
- Variável definida no painel do Netlify vence a do `netlify.toml`.

## Publicação (Netlify)

- Configuração toda no `site/netlify.toml`: base `site`, comando `npm run build`, publicação `build/client`,
  Node 22, redirects, cabeçalhos de segurança e cache longo em `/assets/*`.
- O Netlify só monta quando algo em `site/` mudou (`ignore` com `git diff`); mudança só no motor ou no banco
  não gera deploy.
- Cada PR ganha um **Deploy Preview** com endereço próprio (o link aparece no PR). O preview usa o mesmo
  Supabase de produção: teste com cuidado (o formulário de contato grava de verdade).
- Merge no `main` → deploy de produção em motorcob.online.
- Voltar uma versão: no Netlify, Deploys › escolha o deploy anterior › "Publish deploy".

## CI

O workflow `.github/workflows/site.yml` roda quando `site/**` muda: `npm ci` (lockfile congelado), `npm run lint`,
`npm run typecheck`, `npm test`, a cópia das duas etapas e `npm run build`.

## O que saiu na migração do Horizons

- Plugins do editor (`plugins/`: runtime, editor visual, diário de sessão, restauração de rota no iframe,
  login do PocketBase, logger, cabeçalhos de dev), `horizons-preview-scripts.tsx` (banner, rastreio de
  e-commerce e Google tag do Horizons) e as regras de lint do Horizons.
- O servidor (SSR), as rotas `/api/*`, o `loader` da raiz e as bibliotecas `*.server.ts`.
- O PocketBase (o formulário de contato agora usa o Supabase).
- Os redirecionamentos antigos (`/clusters`, `/usuarios`, `/conta/seguranca`…) continuam iguais, agora no
  navegador (`clientLoader`).

## Login

Depois da senha e das duas etapas, todo login entra no **Início** (`/inicio`), inclusive a equipe. Não há tela
de escolha de área nem área lembrada; a área muda pelos atalhos do Início ou pelo menu. O `?frente=motorcob` ou
`?frente=motorcli` do link continua valendo: troca a área ativa se a pessoa tem acesso (sem acesso, aviso no
topo do Workspace).
