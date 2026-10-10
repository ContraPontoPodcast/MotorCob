# Passo 3 — Página comercial, login novo e rotas

**Referência visual oficial:** `referencia/motorcob-site.html` (abra no navegador; é um protótipo navegável já
aprovado: a home e, no botão "Entrar", o login). Copie o visual, os textos e o comportamento dele. Onde o protótipo
"finge" (formulário, login), use a integração real descrita aqui.

## Rotas
| Rota | O que é | Login? |
|---|---|---|
| `/` | Página comercial (nova) | Não |
| `/login` | Login novo (visual preto do protótipo) | Não |
| `/inicio` | A página inicial atual da plataforma ("Visão da operação"), que hoje está em `/` | Sim |
| `/privacidade` | Política de privacidade do formulário | Não |
| `/cadastro` | **Remover.** Redirecionar para `/login` | — |
| demais | Sem mudança | Sim |

- Item "Início" do menu da plataforma aponta para `/inicio`. Depois do login, ir para `/inicio` (ou para a página
  protegida que a pessoa tentou abrir).
- Usuário já logado que abre `/` vê a página comercial; o botão "Entrar" do topo vira "Ir para a plataforma".

## Identidade (vale para home e login)
- Fonte **Geist** (Google Fonts) para tudo; **Geist Mono** para a linha de código/decisão.
- Preto `#050606`/`#0E1112`, branco, cinzas `#86898B` `#5A5E60`, linhas `#E2E4E5`; **âmbar `#E9A23B` só como
  assinatura** (ponto do logo "MotorCob.", o "0", o "→ CPC · vira Hot", numeração dos agentes).
- Logo em texto: **MotorCob** + ponto final âmbar.
- Muito respiro; títulos gigantes com espaçamento negativo de letra (veja o CSS do protótipo).

## Home — seções (textos exatamente como no protótipo)
1. **Navegação fixa** mínima: logo · Produto · Segurança · Contato · Entrar.
2. **Abertura (preta):** "Pare de adivinhar." + "O MotorCob usa seus agentes de IA para decidir…" + botões
   "Agendar uma conversa" (rola até o contato) e "Assista ao filme (4 min)" (abre modal com
   `MotorCob_video_completo.mp4`, com controles; não toca sozinho) + linha mono da decisão.
3. **Provocações:** três frases que passam de cinza para preto ao chegarem ao meio da tela (o trecho final em âmbar).
4. **"Apresentamos MotorCob."** + imagem `produto-esteira.jpg` com sombra e legenda "dados fictícios".
5. **Decide. Aprende. Prova.** (três colunas com divisórias).
6. **1 · 1 · 0** (contato por cliente · arquivo por canal · planilhas no caminho).
7. **Seus agentes:** Ingestão, Contato, Analista, Estrategista + "A IA aprende. Você decide."
8. **Close:** "O Analista sabe qual canal funciona para quem." + `detalhe-persona.jpg`.
9. **Segurança (preta):** "Dado de devedor não é planilha compartilhada. Nunca foi." + 3 itens.
10. **Contato:** "Mostre a sua carteira." + formulário (abaixo).
11. **Rodapé:** © 2026 MotorCob · Entrar · Contato · Privacidade.

Mídia (bucket público `site`, ver pasta 02): base
`https://jxwppkrkuckfwmphqjva.supabase.co/storage/v1/object/public/site/` + `produto-esteira.jpg`,
`detalhe-persona.jpg`, `MotorCob_video_completo.mp4`, `og-motorcob.jpg`.

## Formulário de contato (real)
- Campos: Nome*, Empresa, E-mail*, Telefone, Mensagem, caixa obrigatória "Concordo que o MotorCob use estes dados
  para retornar o meu contato." e um campo escondido anti-robô (honeypot `site`: se vier preenchido, não envia).
- Envio: `supabase.from('contatos_site').insert({ nome, empresa, email, telefone, mensagem, consentimento: true,
  origem: 'home' })` — **sem `.select()`**.
- Sucesso: "Recebemos. Retornamos em até 1 dia útil." Erro de limite: "Muitas mensagens em pouco tempo. Tente mais
  tarde." Outros erros: "Não conseguimos enviar agora. Tente de novo em instantes."

## Login (real) — `/login`
Visual do protótipo (fundo preto, "Entrar.", campos escuros, botão branco "Continuar").
1. `signInWithPassword({ email, password })`. Erro sempre genérico: "E-mail ou senha incorretos."
2. "Manter conectado" desmarcado → sessão só desta aba (use `sessionStorage` como storage do cliente Supabase).
3. Depois do login: `auth.mfa.getAuthenticatorAssuranceLevel()`.
   - Perfil **Admin** sem fator TOTP → tela de cadastro do autenticador (QR code de `mfa.enroll({factorType:'totp'})`
     + código de 6 dígitos → `mfa.challenge` + `mfa.verify`).
   - Com fator e nível `aal1` → tela **"Só mais um passo."** com os 6 campos do protótipo → `challenge` + `verify`.
   - Só segue para `/inicio` com `aal2` (Admin) ou `aal1` (demais perfis sem fator).
4. "Esqueci a senha" → `resetPasswordForEmail(email, { redirectTo: 'https://motorcob.online/redefinir-senha' })`;
   resposta sempre: "Se o e-mail estiver cadastrado, enviaremos um link para criar uma senha nova."
5. Rodapé: "Acesso só por convite. Sessão encerra após 30 minutos sem uso." (implementado na pasta 05).

## `/privacidade`
Texto simples: dados coletados no formulário (nome, empresa, e-mail, telefone, mensagem), finalidade (retornar o
contato), retenção (até 12 meses), pedido de exclusão pelo e-mail de contato do MotorCob. *Revisar com jurídico.*

## SEO
`<title>MotorCob · Pare de adivinhar.</title>`, description com a frase da abertura, Open Graph com
`og-motorcob.jpg`, `lang="pt-BR"`. `/inicio` e demais rotas da plataforma com `noindex`.

## Critérios de aceite
- Visual igual ao protótipo em 1440 px e 390 px; sem rolagem lateral; `prefers-reduced-motion` desliga animações.
- Lighthouse (home) ≥ 90 em Performance e Acessibilidade; vídeo só carrega ao abrir o modal.
- Contato grava; visitante anônimo não lê `contatos_site`.
- `/cadastro` redireciona; login com Admin exige código; logout limpa a sessão.
