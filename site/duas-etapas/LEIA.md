# Verificação em duas etapas — componente pronto (substitui o que o Horizons gerou)

Dois arquivos, testados (lógica com códigos TOTP reais do RFC 6238; tela no navegador, em React StrictMode;
tipos conferidos contra o supabase-js v2 oficial):

- `duasEtapasLogica.ts` — sem tela: `proximoPasso`, `iniciarCadastro`, `confirmarCodigo`, `cancelarCadastro`.
- `DuasEtapas.tsx` — a tela (cadastro com QR e chave, ou só o código), linha Apple, com erro em português e o
  "Detalhe" técnico embaixo.

Por que o login travava: o site chamava `mfa.verify` sem pedir o desafio antes, deixava cadastros "unverified"
que impediam o próximo e mandava de volta para /login no meio do cadastro. Este componente usa
`challengeAndVerify`, limpa os pela metade antes de cadastrar e fica DENTRO da página /login.

## Como colocar no site

1. Copie os dois arquivos para `src/components/` (no Horizons: prompt 20 da página de prompts, que já traz o
   conteúdo dos dois). Apague todo o código antigo de duas etapas.
2. Página /login, depois do `signInWithPassword`:

```tsx
import DuasEtapas from "@/components/DuasEtapas";
import { proximoPasso, type Passo } from "@/components/duasEtapasLogica";

const [passo, setPasso] = useState<Passo | null>(null);

async function depoisDoLogin(userId: string) {
  const { data: perfil } = await supabase.from("perfis").select("papel").eq("id", userId).single();
  const p = await proximoPasso(supabase, perfil?.papel === "admin");   // Admin é obrigado a cadastrar
  if (p.etapa === "pronto") navigate("/workspace");
  else setPasso(p);
}

// no JSX da página:
{passo && passo.etapa !== "pronto"
  ? <DuasEtapas supabase={supabase} passo={passo} onPronto={() => navigate("/workspace")} onSair={() => setPasso(null)} />
  : <FormularioDeSenha onEntrou={depoisDoLogin} />}
```

3. Ao abrir /login já com sessão (por exemplo, vindo do guarda de rota), chame `depoisDoLogin(session.user.id)`
   em vez de mostrar o formulário de senha.
4. Guarda das páginas protegidas: sem sessão → /login. Com sessão → `proximoPasso(supabase, ehAdmin)`; se não for
   "pronto", mande para /login (que mostra a etapa certa). Nenhum outro lugar do site decide sobre duas etapas.
5. Minha conta › Segurança › "Ligar": renderize `<DuasEtapas passo={{ etapa: "cadastro" }} … />` num modal.

Para desligar temporariamente a obrigatoriedade do Admin: `proximoPasso(supabase, ehAdmin, false)`.

## Testes

    node --experimental-strip-types --test site/duas-etapas/duasEtapasLogica.test.ts
