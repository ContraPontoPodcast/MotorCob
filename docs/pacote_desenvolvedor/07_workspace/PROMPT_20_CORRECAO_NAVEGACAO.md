# Prompt Horizons — Workspace 20: correção da navegação única (o prompt 16 não foi aplicado)

Conferido no site publicado: a Mensageria e o Console ainda estão no layout do Workspace (barra no topo, pílula do
canal e abas), e o menu escuro da Orquestração não tem "Voltar ao Workspace" nem seletor de produto. Este prompt
faz só essa mudança, com os nomes dos arquivos do projeto. Protótipo: https://claude.ai/artifact/XWCscHJhaWo4HQNM9MzUGf

```text
CORREÇÃO DE ESTRUTURA (o que pedi no prompt de navegação única não foi feito). Não mude consultas, tabelas,
permissões nem o conteúdo das telas: só QUAL LAYOUT envolve cada rota e o topo do menu lateral.

1. ROTAS: hoje routes/workspace-layout envolve mensageria-index, mensageria-canal-layout (e filhas), console,
   console-* e relatorios. MOVA essas rotas para dentro de routes/app-layout (o layout com o menu lateral escuro,
   app-shell, o mesmo da Orquestração), mantendo os mesmos caminhos (/mensageria, /mensageria/:canal/...,
   /console/..., /relatorios). No workspace-layout ficam SÓ: workspace, empresa*, conta*, suporte*, docs*,
   documentacao. O menu recolhível (mc-menu-recolhido) continua valendo para todos.

2. MENU LATERAL (app-shell) MOSTRA O PRODUTO DA ROTA ATUAL: /mensageria* = Mensageria, /console* = Console,
   o resto = Orquestração. No topo do menu, abaixo do logo, nesta ordem:
   a) "‹ Voltar ao Workspace" (13px #8E8E93, hover branco) → /workspace. Recolhido: só o ícone ArrowLeft.
   b) Seletor de empresa (o que já existe).
   c) SELETOR DE PRODUTO: botão largo (fundo rgba(255,255,255,.08), raio 10, 40px): "Produto" 11px, nome do
      produto, ponto 8px na cor (Orquestração #C9A35A, Mensageria #7A4FB0, Console #8E8E93) e ChevronDown. Lista:
      Workspace · divisória · Orquestração → /inicio · Mensageria → /mensageria/{último canal} · Console MotorCob →
      /console/saude (só equipe). Produto sem módulo ativo: esmaecido com "Quero conhecer" (a janela que já existe).
   d) Só na Mensageria: controle segmentado escuro com os canais liberados (SMS · RCS · E-mail · WhatsApp; trilho
      rgba(255,255,255,.06), ativo rgba(255,255,255,.16) texto branco; não liberado desabilitado). Trocar o canal
      mantém a tela (/mensageria/sms/campanhas → /mensageria/rcs/campanhas).

3. ITENS DO MENU POR PRODUTO (rótulos de grupo 11px 600 #8E8E93):
   MENSAGERIA: Operação: Painel, Campanhas, Lotes do dia · Atendimento: Respostas (selo azul de não lidas) ·
   Conteúdo: Templates (SMS e RCS) ou Modelo de e-mail (E-mail), Listas · Análise: Relatórios · Administração:
   Configurações. CONSOLE: Operação: Saúde, Empresas, Atendimento · Financeiro: Faturamento, Fornecedores, Margem ·
   Administração: Equipe. ORQUESTRAÇÃO: os itens de hoje. Grupo fixo no fim dos três: Relatórios (fora da
   Mensageria) · Usuários e permissões · Auditoria.

4. APAGUE do mensageria-canal-layout a pílula colorida do canal e a barra de abas cinza (viraram menu). Cada tela
   usa o cabeçalho padrão da Orquestração: título 28px 700 e a linha "{empresa} · Mensageria · {canal} · {data}",
   o selo Simulação/Envio real ao lado do título e o botão principal à direita. O mesmo no Console.

5. AVATAR DO ASSISTENTE também no app-shell: reaproveite o MESMO componente do workspace-shell (botão 64px com a
   foto do avatar, balão "Dúvida? Fala comigo!" e a mesma gaveta). Sem cobrir o botão principal nem a
   paginação; se cobrir, suba o botão só naquela tela.

6. Workspace: tire "Mensageria" da barra do topo (o produto abre pelo card "Abrir Mensageria ›" do Início).

Confira em 1440, 1024 e 390px: /workspace com barra no topo; /inicio, /mensageria/sms e /console/saude com o
MESMO menu lateral, "Voltar ao Workspace", seletor de produto e avatar.
```
