# Prompt Horizons — Navegação única (Orquestração, Mensageria, Workspace e Console no mesmo esqueleto)

Rode depois dos prompts 1 a 15. Corrige a experiência: hoje a Orquestração usa menu lateral escuro e o
Workspace/Mensageria usam barra no topo com abas. Tudo passa a usar o MESMO menu lateral, com seletor de produto.

```text
Unifique a navegação de toda a área logada. Não mude rotas, tabelas, views, políticas, consultas ou o conteúdo das
telas: só o esqueleto (menu, cabeçalho e onde ficam os links). Linha Apple de sempre (tokens --mc-*).

1. UM ESQUELETO SÓ: todas as telas logadas (/inicio e telas da Orquestração, /workspace, /empresa, /conta, /suporte,
   /mensageria/..., /relatorios, /docs, /console/...) usam o MENU LATERAL ESCURO da Orquestração (232px, #161617,
   mesmos itens, ícones Lucide 16px, hover e ativo iguais). REMOVA a barra escura do topo do Workspace e as abas de
   navegação da Mensageria e do Console (viram itens do menu). Abaixo de 980px: barra escura no topo com logo e botão
   "Menu" que abre o mesmo menu como gaveta (igual à Orquestração hoje).

2. TOPO DO MENU, nesta ordem:
   a) Logo (símbolo Rotor + "MotorCob").
   b) Seletor de empresa (o mesmo de hoje: equipe vê lista com busca; cliente vê só o nome da própria empresa).
   c) SELETOR DE PRODUTO: botão largo (fundo rgba(255,255,255,.08), raio 10, 40px) com ponto 8px na cor do produto,
      nome do produto e ChevronDown. Abre lista: Orquestração (#C9A35A) · Mensageria (#7A4FB0) · e, só para a
      equipe, Console MotorCob (#C9A35A, ícone Shield). Produto sem módulo ativo aparece esmaecido com "Quero
      conhecer" (abre a janela de interesse comercial). Trocar de produto vai para a tela inicial dele e lembra a
      escolha (localStorage) para o próximo login. O produto atual também é deduzido da rota.
   d) Só na Mensageria: logo abaixo, os canais liberados como controle segmentado escuro (SMS · RCS · E-mail ·
      WhatsApp; trilho rgba(255,255,255,.06), ativo rgba(255,255,255,.16) com texto branco). Trocar o canal mantém
      a mesma tela no outro canal (ex.: /mensageria/sms/campanhas → /mensageria/rcs/campanhas).

3. ITENS DO MENU POR PRODUTO (rótulos de grupo 11px 600 #8E8E93, como hoje):
   ORQUESTRAÇÃO (como hoje): Operação: Início, Lista do dia, Ações, Painel · Carteira: Clientes, Personas, Credores ·
   Estratégia: Mapa da Esteira, Orquestração, Comitê · Dados: Enviar arquivos · Administração: Canais e frases.
   MENSAGERIA ({canal} = canal ativo): Operação: Painel (/mensageria/{canal}), Campanhas, Lotes do dia ·
   Atendimento: Respostas (selo com o total de nao_lidas das conversas abertas do canal) · Conteúdo: Templates
   (SMS e RCS) ou Modelo de e-mail (E-mail), Listas · Análise: Relatórios (/relatorios já filtrado pelo canal) ·
   Administração: Configurações.
   CONSOLE (só equipe): Saúde, Empresas, Atendimento, Faturamento, Fornecedores, Margem, Equipe.
   GRUPO FIXO, IGUAL EM TODOS OS PRODUTOS (no fim da lista, separado por uma linha #2C2C2E): Empresa · Suporte ·
   Relatórios (quando o produto não for Mensageria) · Usuários e permissões · Auditoria · Documentação.
   "Início" do Workspace (/workspace) vira o item "Visão geral" no topo da lista de qualquer produto.

4. RODAPÉ DO MENU: avatar 32px + nome + perfil (como na Orquestração). Clique abre o MESMO menu do usuário de hoje
   (Minha conta, Documentação, Sobre o MotorCob, Sair), agora saindo do rodapé para cima.

5. CABEÇALHO DE CADA TELA, IGUAL EM TODOS OS PRODUTOS (o da Orquestração): título 28px 700 à esquerda e a linha
   de contexto 15px #6E6E73 = "{empresa} · {produto} · {canal, na Mensageria} · {data por extenso}". À direita:
   "Buscar cliente" (só ID ou contrato; ⌘K/Ctrl+K) e o botão principal da tela (pílula #1D1D1F). Nada de barra
   acima do título. Na Mensageria, o selo de modo (Simulação/Envio real) fica ao lado do título.

6. ABAS DENTRO DA TELA: só para partes da mesma tela (ex.: Bloqueio/Favoritos em Listas, Padrão/Personalizados/
   Novo em Relatórios), sempre com o controle segmentado claro do sistema e texto #1D1D1F. Nunca use abas para ir
   de uma seção principal a outra: isso é sempre o menu lateral.

7. MESMOS COMPONENTES EM TUDO: cards de número (#F5F5F7, raio 16, rótulo 13px com ponto, número 30px 600),
   tabelas/listas brancas com sombra de card, botões principal/secundário, selos, interruptores, avisos e estados
   vazios iguais aos da Orquestração. Revise as telas da Mensageria, Workspace, Relatórios e Console e troque
   qualquer variação (outros raios, cores de botão, títulos menores, cards com borda) pelo padrão.

Confira em 1440, 1024 e 390px: a pessoa deve achar o menu, o título, a busca e o botão principal no mesmo lugar em
qualquer produto.
```
