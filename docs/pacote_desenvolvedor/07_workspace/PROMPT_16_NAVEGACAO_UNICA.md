# Prompt Horizons — Navegação única dentro dos produtos (Orquestração, Mensageria e Console)

Rode depois dos prompts 1 a 15. O Workspace continua como está (barra no topo) e é a primeira tela depois do login.
Ao entrar num produto, todos usam o MESMO menu lateral. Protótipo: https://claude.ai/artifact/XWCscHJhaWo4HQNM9MzUGf

```text
Unifique a navegação DENTRO DOS PRODUTOS. Não mude o Workspace, rotas, tabelas, views, políticas, consultas ou o
conteúdo das telas: só o esqueleto dos produtos. Linha Apple de sempre (tokens --mc-*).

1. WORKSPACE (NÃO MUDA): continua com a barra escura no topo e é a tela depois do login (/workspace). Páginas do
   Workspace: Início, Empresa, Minha conta, Suporte, Documentação e Console (só equipe). Só dois ajustes:
   - Tire "Mensageria" da barra do topo: os produtos são abertos pelos cards de "Seus produtos" no Início.
   - Cada card de produto ativo ganha o botão principal "Abrir {produto} ›": Orquestração → Lista do dia,
     Mensageria → /mensageria/{último canal usado}, Console (equipe) → /console/saude.

2. DENTRO DE UM PRODUTO, UM ESQUELETO SÓ: Orquestração (/inicio, Lista do dia e demais), Mensageria
   (/mensageria/...) e Console (/console/...) usam o MENU LATERAL ESCURO da Orquestração (232px, #161617, itens,
   ícones Lucide 16px, hover e ativo iguais). REMOVA as abas de navegação da Mensageria e do Console (viram itens do
   menu). Abaixo de 980px: barra escura no topo com logo e "Menu" que abre o mesmo menu como gaveta.

3. TOPO DO MENU, nesta ordem:
   a) Logo (símbolo Rotor + "MotorCob").
   b) "‹ Voltar ao Workspace" (13px #8E8E93, hover branco) → /workspace.
   c) Seletor de empresa (o mesmo de hoje: equipe vê lista com busca; cliente vê só o nome da própria empresa).
   d) SELETOR DE PRODUTO: botão largo (fundo rgba(255,255,255,.08), raio 10, 40px) com "Produto" em 11px, o nome do
      produto, ponto 8px na cor dele e ChevronDown. Lista: Workspace (volta ao início) · divisória · Orquestração
      (#C9A35A) · Mensageria (#7A4FB0) · Console MotorCob (só equipe). Produto sem módulo ativo aparece esmaecido com
      "Quero conhecer" (janela de interesse comercial). Trocar de produto vai para a tela inicial dele.
   e) Só na Mensageria: os canais liberados num controle segmentado escuro (SMS · RCS · E-mail · WhatsApp; trilho
      rgba(255,255,255,.06), ativo rgba(255,255,255,.16) branco; canal não liberado desabilitado). Trocar o canal
      mantém a mesma tela no outro canal (/mensageria/sms/campanhas → /mensageria/rcs/campanhas) e é lembrado.

4. ITENS DO MENU POR PRODUTO (rótulos de grupo 11px 600 #8E8E93):
   ORQUESTRAÇÃO (como hoje): Operação: Início, Lista do dia, Ações, Painel · Carteira: Clientes, Personas, Credores ·
   Estratégia: Mapa da Esteira, Orquestração, Comitê · Dados: Enviar arquivos · Administração: Canais e frases.
   MENSAGERIA ({canal} = canal ativo): Operação: Painel (/mensageria/{canal}), Campanhas, Lotes do dia ·
   Atendimento: Respostas (selo azul com o total de nao_lidas das conversas abertas do canal) · Conteúdo: Templates
   (SMS e RCS) ou Modelo de e-mail (E-mail), Listas · Análise: Relatórios (/relatorios filtrado pelo canal) ·
   Administração: Configurações.
   CONSOLE (só equipe): Operação: Saúde, Empresas, Atendimento · Financeiro: Faturamento, Fornecedores, Margem ·
   Administração: Equipe.
   GRUPO FIXO no fim, igual nos três (separado por uma linha #2C2C2E): Relatórios (fora da Mensageria) · Usuários e
   permissões · Auditoria.

5. RODAPÉ DO MENU: avatar 32px + nome + perfil. Clique abre o mesmo menu do usuário do Workspace (Minha conta,
   Documentação, Sobre o MotorCob, Sair), saindo do rodapé para cima.

6. CABEÇALHO DE CADA TELA DOS PRODUTOS (o da Orquestração): título 28px 700 à esquerda e a linha de contexto 15px
   #6E6E73 = "{empresa} · {produto} · {canal, na Mensageria} · {data por extenso}". À direita: "Buscar cliente" (só
   ID ou contrato; ⌘K/Ctrl+K) e o botão principal da tela (pílula #1D1D1F). Na Mensageria, o selo de modo
   (Simulação/Envio real) fica ao lado do título.

7. ABAS DENTRO DA TELA: só para partes da mesma tela (Bloqueio/Favoritos em Listas; Padrão/Personalizados/Novo em
   Relatórios), com o controle segmentado claro do sistema e texto #1D1D1F. Para ir de uma seção a outra, sempre o
   menu lateral.

8. MESMOS COMPONENTES nos três produtos: cards de número (#F5F5F7, raio 16, rótulo 13px com ponto, número 30px 600),
   tabelas/listas brancas com sombra de card, botões, selos, interruptores, avisos e estados vazios iguais aos da
   Orquestração. Troque qualquer variação nas telas da Mensageria e do Console pelo padrão.

Confira em 1440, 1024 e 390px: depois do login abre o Workspace; dentro de qualquer produto, menu, título, busca e
botão principal ficam sempre no mesmo lugar.
```
