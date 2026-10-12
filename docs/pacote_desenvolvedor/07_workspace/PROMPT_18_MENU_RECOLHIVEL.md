# Prompt Horizons — Workspace 18: menu lateral recolhível dentro dos produtos

Rode depois do prompt 16 (navegação única). Só no menu lateral escuro dos produtos; o Workspace não muda.
Protótipo: https://claude.ai/artifact/XWCscHJhaWo4HQNM9MzUGf (entre num produto e clique no botão ao lado do logo).

```text
Deixe o MENU LATERAL ESCURO dos produtos (Orquestração, Mensageria e Console) recolhível. Não mude rotas, itens,
permissões nem o conteúdo das telas.

1. BOTÃO: ao lado do logo, à direita, botão 28px (ícone Lucide PanelLeftClose; recolhido, PanelLeftOpen), cor
   #8E8E93, hover branco com fundo rgba(255,255,255,.08), raio 8. aria-label "Recolher menu" / "Expandir menu" e
   aria-expanded. Atalho: ⌘B / Ctrl+B.

2. RECOLHIDO (64px): só os ícones (20px) centralizados; somem textos, rótulos de grupo, nomes da empresa e do
   produto. Os grupos ficam separados por uma linha #2C2C2E de 24px. Item ativo: mesmo fundo do ativo de hoje,
   quadrado 40px raio 10. Contadores (selo azul de Respostas) viram um ponto azul 8px no canto do ícone.
   - "Voltar ao Workspace": ícone ArrowLeft.
   - Empresa: ícone Building2 (clique abre o mesmo seletor, saindo para a direita).
   - Produto: ponto 10px na cor do produto (clique abre a mesma lista de produtos, para a direita).
   - Canais da Mensageria: os 4 canais empilhados como ícones (MessageSquare SMS, MessageCircle RCS, Mail E-mail,
     Phone WhatsApp), ativo com fundo rgba(255,255,255,.16).
   - Rodapé: só o avatar 32px do usuário (o menu do usuário abre para cima e para a direita).
3. DICA: no recolhido, passar o mouse ou focar com o teclado mostra o nome do item num balão escuro (#1D1D1F,
   texto branco 13px, raio 8) à direita do ícone, depois de 300ms. Os itens continuam navegáveis por Tab.
4. ANIMAÇÃO: largura 232px ⇄ 64px em 200ms ease (sem animação se o sistema pedir menos movimento); o conteúdo da
   tela acompanha (sem pular). Lembre a escolha no navegador (chave mc-menu-recolhido) e aplique antes de pintar a
   tela, para não piscar.
5. CELULAR (abaixo de 980px): não muda — continua a barra do topo com "Menu" abrindo o menu inteiro como gaveta.

Confira em 1440 e 1024px (recolhido e aberto) e 390px: nenhum texto cortado, dicas visíveis, sem rolagem lateral.
```
