# Prompt Horizons — Ligar a tela de duas etapas (depois de colar os dois arquivos no editor)

```text
Os arquivos src/components/duasEtapasLogica.js e src/components/DuasEtapas.jsx já existem e estão corretos.
NÃO altere, NÃO reescreva e NÃO formate esses dois arquivos. Só faça o seguinte:

1. Apague os arquivos src/components/duasEtapasLogica.ts e src/components/DuasEtapas.tsx, se existirem.
2. Apague todo o código antigo de duas etapas (MFA) do site: telas de código ou de QR, chamadas a
   supabase.auth.mfa.* fora desses dois arquivos, guardas de rota e efeitos que tratam de aal1/aal2.
3. Na página /login, depois do signInWithPassword que deu certo (e ao abrir /login já com sessão):
   import DuasEtapas from "@/components/DuasEtapas";   (ou o caminho relativo certo)
   import { proximoPasso } from "@/components/duasEtapasLogica";
   const { data: perfil } = await supabase.from("perfis").select("papel").eq("id", user.id).single();
   const passo = await proximoPasso(supabase, perfil?.papel === "admin");
   - se passo.etapa === "pronto": navegue para a página inicial;
   - senão: guarde passo num useState e, no lugar do formulário de senha, mostre
     <DuasEtapas supabase={supabase} passo={passo} onPronto={() => navegar para a página inicial}
                 onSair={() => { setPasso(null); }} />
4. Guarda das páginas protegidas: sem sessão → /login. Com sessão: proximoPasso(supabase, ehAdmin); se a etapa
   não for "pronto", mande para /login. Nenhum outro lugar do site decide sobre duas etapas.
```
