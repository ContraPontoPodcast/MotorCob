# Prompt Horizons — Sistema na linha Apple (menu escuro)
Rode depois da pasta 03. Cole no Horizons e publique (imagens de apoio em `telas/`):

```text
Troque o visual da PLATAFORMA (área logada) para a linha Apple com menu lateral escuro. Não mude rotas, gravações,
tabelas, views, políticas ou regras. Só visual, cabeçalhos e a Lista do dia (abaixo).

TOKENS (CSS variables globais; nenhuma cor/fonte solta)
--mc-bg #FFFFFF · --mc-fill #F5F5F7 · --mc-fill-2 #F2F2F7 · --mc-segment #EEEEF0 · --mc-separator #E5E5EA ·
--mc-separator-soft #F0F0F2 · --mc-border-field #D2D2D7 · --mc-label #1D1D1F · --mc-label-2 #6E6E73 ·
--mc-label-3 #8E8E93 · --mc-brand #C9A35A · --mc-green #34C759 · --mc-green-text #248A3D · --mc-orange #FF9500 ·
--mc-red #FF3B30 · --mc-gray #AEAEB2 · --mc-menu #161617 · sombra de card 0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04).
Fonte do sistema (-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui), sem arquivo de fonte e
sem fonte mono; números com tabular-nums. Remova Inter/Geist e todo #0F4C5C, #103E4B e #E9A23B da interface.

LOGO: troque o quadrado "M" e o "Gestão de contatos" pelo símbolo Rotor (nunca hélice/pás) + "MotorCob" 15px 600
branco. Champanhe #C9A35A só dentro do símbolo. No menu escuro, 24px, exatamente: <svg viewBox="0 0 100 100" width="24" height="24" aria-hidden="true"><circle cx="50" cy="50" r="38" fill="none" stroke="#3A3A3C" stroke-width="11"/><path d="M50 12 A38 38 0 0 1 86.1 38.3" fill="none" stroke="#C9A35A" stroke-width="11" stroke-linecap="round"/><path d="M83.6 70 A38 38 0 0 1 30 82.3" fill="none" stroke="#EEEAE2" stroke-width="11" stroke-linecap="round"/><path d="M16.4 67.6 A38 38 0 0 1 22 23.5" fill="none" stroke="#EEEAE2" stroke-width="11" stroke-linecap="round" opacity="0.55"/><circle cx="50" cy="50" r="11" fill="#C9A35A"/></svg>

MENU LATERAL ESCURO (232px, fundo #161617)
Grupos (rótulo 11px 600 #8E8E93, sem caixa-alta): Operação: Início, Lista do dia, Ações, Painel · Carteira:
Clientes, Personas, Credores · Estratégia: Mapa da Esteira, Orquestração, Comitê · Dados: Enviar arquivos ·
Administração: Canais e frases, Usuários e permissões, Auditoria. Item: padding 6px 10px, raio 7, 14px #E5E5EA,
ícone Lucide 16px #AEAEB2; hover rgba(255,255,255,.06); ativo fundo rgba(255,255,255,.12), branco, peso 600,
aria-current="page". Rodapé: avatar #3A3A3C, nome branco, perfil #8E8E93, "Sair". Abaixo de 980px: barra escura
no topo com logo e botão "Menu".

CABEÇALHO DE CADA TELA (remova a barra superior atual de busca/seletores)
Conteúdo com padding 28px em cima e clamp(16px,4vw,48px) dos lados, 28px entre blocos. Esquerda: título 28px 700
e contexto em #6E6E73 (ex.: "Banco X · Assessoria Demo · 5 de outubro"). Direita: campo "Buscar cliente" (260px,
36px, raio 10, fundo #F2F2F7, sem borda, ⌘K/Ctrl+K, busca SÓ por ID do cliente ou contrato), botão secundário do
credor e o botão principal da tela. Títulos: Início, Lista do dia, Orquestração, Personas, "Cliente {ID}",
Usuários e permissões; demais telas usam o nome do menu. Datas por extenso.

COMPONENTES
Botão principal: 36px, pílula, #1D1D1F, texto branco 500 15px, hover opacidade .85. Secundário: 36px, raio 10,
#F2F2F7, sem borda. Card de KPI: #F5F5F7, raio 16, padding 18px 20px, sem borda; rótulo 13px #6E6E73 com ponto
8px; número 30px 600 sem cor; % em #6E6E73 (em "Com ação hoje", #248A3D); grade auto-fit minmax(180px,1fr) gap 12.
Cards e listas: branco, raio 16, sombra de card, sem borda; linhas padding 12px 20px, divisória #F0F0F2, hover
#F5F5F7. Filtros viram controle segmentado (trilho #EEEEF0, padding 2, raio 9, segmento 30px 13px 500, ativo
branco com sombra 0 1px 3px rgba(0,0,0,.12)). Interruptores estilo iOS (42x26, ligado #34C759). Selos 12px 500
em fundo #F5F5F7 (Ativo/Ligado em #248A3D sobre rgba(52,199,89,.12)). Avisos: fundo #F5F5F7, ícone laranja.
Barras 4px com trilho #E5E5EA. Sem caixa-alta, sem itálico, sem gradiente.

LISTA DO DIA (fonte: view motivos_hoje, colunas categoria, titulo, clientes; filtre pelo credor escolhido)
categoria vazia = regra_esteira. Total = soma de clientes. 4 cards: Carteira avaliada (total), Com ação hoje
(com_acao), Fora por regra da esteira (regra_esteira), Sem contato válido (sem_contato), com % do total.
"Por que hoje" (20px 600) + segmentado Todos / Em ação / Esteira / Sem contato (encerrado só em Todos).
Cada linha: grade 8px | 1fr | 160px | 64px = ponto · titulo (15px, uma linha) com legenda 13px #6E6E73 · barra ·
quantidade. Cores: com_acao #34C759, regra_esteira #FF9500, sem_contato #FF3B30, encerrado #AEAEB2. Legendas:
"Liberados para todos os canais", "Regra da esteira", "Sem contato para os canais do dia", "Fora da cobrança".
Ordem: com_acao primeiro, depois maior quantidade. Celular: esconda a barra. Botão principal "Baixar lista".

ORQUESTRAÇÃO: canais como pílulas SÓLIDAS na cor do canal, texto branco (WhatsApp #1F8A4C, RCS #3B5BA9, SMS
#7A4FB0, E-mail #A2552B, Agente virtual #0E7C86, Discador #475569, Enriquecimento #64748B), na paleta e nos dias.
Bolinha de frase (ícone MessageCircle 18px) na pílula: com frase = branca cheia com balão na cor do canal e tooltip
com o nome da frase; sem frase = contorno branco 70%; desativada = vermelha #C62828. Faixas como cards
recolhíveis com selo "Ligado"; dia vazio tracejado "solte um canal aqui".

PERSONAS: anel de maturidade 84px (o número é a maturidade, não clientes) na cor da persona (paleta #1F8A4C #A2552B #C62828 #3B5BA9 #7A4FB0 #0E7C86,
trilho #E5E5EA), pontinho da cor ao lado do nome. Ranking: melhor canal e 2º na cor do canal, demais #C7C7CC;
valor "29,1% CPC" sem quebrar linha.

Sem rolagem lateral em 1440, 1024 e 390px. Foco visível: outline 3px rgba(0,113,227,.5).
```
