# Passo 3 — Site público, login e rotas (linha Apple)

**Referência oficial:** `referencia/motorcob-prototipo.html`. Abra no navegador: é o protótipo navegável aprovado
(site → "Entrar" → código de 6 dígitos → sistema). Copie visual, textos e comportamento. Onde o protótipo "finge"
(formulário, login, código), use a integração real descrita aqui. Imagens: `imagens/site_inteiro.png`, `imagens/login.png`.
Tokens, fonte e componentes: pasta `04` (valem também aqui).

## Rotas
| Rota | O que é | Login? |
|---|---|---|
| `/` | Site público (novo) | Não |
| `/login` | Login novo | Não |
| `/inicio` | Início da plataforma (hoje em `/`) | Sim |
| `/privacidade` | Política do formulário | Não |
| `/cadastro` | **Remover.** Redirecionar para `/login` | — |

Depois do login, ir para `/inicio` (ou para a página protegida que a pessoa tentou abrir). Usuário logado que abre
`/` vê o site; o botão "Entrar" do topo vira "Ir para a plataforma".

## Site — cabeçalho
Fixo no topo, **escuro** translúcido: fundo `rgba(22,22,23,.88)` + `backdrop-filter: saturate(180%) blur(20px)`,
altura 52 px. Logo (símbolo versão escura, 24 px) + "MotorCob" branco 15/600. Atalhos à direita, 13 px, branco 80%:
**Produto · Lista do dia · Personas · Agentes · Segurança · Contato** e botão "Entrar" (pílula `rgba(255,255,255,.14)`).
- Cada atalho rola suavemente até a seção (`scrollIntoView({behavior:'smooth'})`), sem trocar de rota.
  Âncoras: `#produto`, `#lista-site`, `#personas-site`, `#agentes`, `#seguranca`, `#contato`.
- Toda seção com `scroll-margin-top: 64px` (92 px no celular), para o título não ficar atrás do cabeçalho.
- Celular (< 720 px): os atalhos descem para uma segunda linha com rolagem lateral só dentro dela.

## Site — seções (textos exatamente como no protótipo)
Fundo alternando branco e `#F5F5F7`. Títulos 700, espaçamento de letra −0,035em, sem itálico, sem caixa-alta.
1. **Abertura** (centralizada): "Inteligência de contato para cobrança" · **"Pare de adivinhar."** · texto
   "O MotorCob usa seus agentes de IA…" · botões "Agendar uma conversa" (principal, rola até o contato) e
   "Ver a plataforma" (secundário, rola até Produto) · **cartão "Como o MotorCob decide um cliente, antes do
   primeiro disparo do dia"** (fundo `#F5F5F7`, raio 18, até 980 px): 6 etapas ligadas por uma linha, cada uma
   com rótulo 12 px cinza e valor 15/600 — Cliente 100004817 · Momento Atraso recente · Dia na régua D+3 · Canal
   escolhido WhatsApp · Telefone Hot (11) 9••••-••17 · Resultado CPC · vira Hot (verde `#248A3D`, ponto `#34C759`) —
   e a nota "Dados fictícios. O MotorCob mostra só o ID do cliente, nunca CPF ou telefone completo." No celular as
   etapas viram lista vertical (rótulo à esquerda, valor à direita).
2. **Provocações** (fundo cinza): três frases que passam de `#C7C7CC` para `#1D1D1F` ao chegar a 62% da altura
   da tela (o trecho final fica `#6E6E73`). Com `prefers-reduced-motion`, já aparecem escuras.
3. **Apresentamos MotorCob** + "Da carga à ação, com inteligência." + **prévia da Lista do dia** (`#lista-site`):
   janela com cabeçalho cinza, título "Lista do dia", contexto, 4 cards de KPI e 4 linhas de motivo. Dados fictícios.
4. **Decide. Aprende. Prova.** (fundo cinza, três colunas).
5. **Personas** (`#personas-site`): "Cada perfil tem o seu canal." + texto + 3 painéis iguais aos da tela Personas
   do sistema (pasta 04). Dados fictícios.
6. **Seus agentes:** Ingestão, Contato, Analista, Estrategista (cards cinza) + "A IA aprende. Você decide."
7. **Segurança** (fundo cinza): "Dado de devedor não é planilha compartilhada. Nunca foi." + 3 itens.
8. **Contato:** "Mostre a sua carteira." + formulário.
9. **Rodapé** (cinza): © 2026 MotorCob · Entrar · Contato · Privacidade.

A prévia e os painéis do site são **estáticos** (dados fictícios no código), nunca lidos do banco.

## Formulário de contato (real)
- Campos: Nome*, Empresa, E-mail*, Telefone, Mensagem, caixa obrigatória "Concordo que o MotorCob use estes dados
  para retornar o meu contato." e campo escondido anti-robô (honeypot `site`: se vier preenchido, não envia).
- Envio: `supabase.from('contatos_site').insert({ nome, empresa, email, telefone, mensagem, consentimento: true,
  origem: 'home' })` — **sem `.select()`**.
- Sucesso: "Recebemos. Retornamos em até 1 dia útil." Limite: "Muitas mensagens em pouco tempo. Tente mais
  tarde." Outros erros: "Não conseguimos enviar agora. Tente de novo em instantes."

## Login (real) — `/login`
Tela branca, coluna de 380 px centralizada: símbolo 56 px · **"Entre no MotorCob."** (34/600) · "O contato certo,
no canal certo, antes de cada disparo." (17 px, `#6E6E73`) · grupo de campos E-mail e Senha no mesmo bloco
(borda `#D2D2D7`, raio 14, rótulo 12 px em cima, valor 17 px) · "Manter conectado" · botão **"Continuar"**
(50 px, largura total, raio 12, `#1D1D1F`, texto branco 17 px) · "Esqueceu a senha?" · "Acesso exclusivo para
equipes convidadas. Primeiro acesso". Link discreto "‹ Voltar ao site" no canto superior esquerdo.
1. `signInWithPassword({ email, password })`. Erro sempre: "E-mail ou senha incorretos."
2. "Manter conectado" desmarcado → sessão só desta aba (`sessionStorage` como storage do cliente Supabase).
3. `auth.mfa.getAuthenticatorAssuranceLevel()`:
   - **Admin** sem fator TOTP → cadastro do autenticador (QR de `mfa.enroll({factorType:'totp'})` + código).
   - Com fator e nível `aal1` → tela **"Digite o código."** com 6 campos (56 px, raio 12) → `challenge` + `verify`.
   - Só segue com `aal2` (Admin) ou `aal1` (demais perfis sem fator). Enquanto carrega: "Preparando a lista de hoje…"
4. "Esqueceu a senha?" → `resetPasswordForEmail(email, { redirectTo: 'https://motorcob.online/redefinir-senha' })`;
   resposta sempre: "Se o e-mail estiver cadastrado, enviaremos um link para criar uma senha nova."
5. "Primeiro acesso" → "Use o link do convite enviado pelo Admin da sua empresa."

## `/privacidade`
Dados do formulário (nome, empresa, e-mail, telefone, mensagem), finalidade (retornar o contato), retenção (até 12
meses), exclusão pelo e-mail de contato do MotorCob. *Revisar com jurídico.*

## SEO
`<title>MotorCob · Pare de adivinhar.</title>`, description com a frase da abertura, Open Graph com
`og-motorcob.jpg` (bucket `site`, pasta `imagens/`), `lang="pt-BR"`. Rotas da plataforma com `noindex`.

## Critérios de aceite
- Igual ao protótipo em 1440, 1024 e 390 px, no Mac e no Windows; sem rolagem lateral.
- Cada atalho do cabeçalho leva à seção certa, com o título visível abaixo do cabeçalho.
- Nenhum arquivo de fonte carregado (fonte do sistema). Champanhe só no símbolo do logo.
- Contato grava; visitante não lê `contatos_site`. `/cadastro` redireciona. Admin precisa do código.
- Lighthouse do site ≥ 90 em Performance e Acessibilidade.
