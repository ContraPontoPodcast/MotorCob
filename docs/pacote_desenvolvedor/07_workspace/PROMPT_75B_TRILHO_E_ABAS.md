# Prompt Horizons — 75b: moldura nova (trilho de ícones, faixa de contexto e abas por área)

UX + CX, 25/10/2026. Rode depois do 75a e só com o `produto-prototipo.html` aprovado pelo dono.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Nada de CPF ou nome de devedor. Não mude rotas, ids, parâmetros
nem o conteúdo das telas. A PÁGINA (window) continua rolando; não ponha rolagem dentro de um cartão.

## 1. Trilho e faixa de contexto (app-shell e workspace-shell usam a mesma moldura)
1.1 Tire o menu lateral (aside.mc-menu) e a barra do topo do assistente-gaveta. Antes, mova para a moldura nova: o
    keydown do ⌘K e o evento motorcob:focus-busca; o efeito do contador do Suporte (chamados aguardando_cliente a
    cada 60 s + mc:suporte-visto); o sino (U); o menu do avatar (X); a pílula da empresa (q).
1.2 Trilho: position fixed, top/left/bottom 10 px, largura 64, raio 16, borda var(--base-borda), fundo
    var(--base-cartao). De cima para baixo: símbolo da marca (→ /inicio) · Início (LayoutGrid) · Cobrança (Wallet) ·
    Jornada do Cliente (Route) · Mensageria (MessageSquare) · Relatórios (ChartColumn) · espaço · Empresa
    (Building2) · Suporte (LifeBuoy, com o contador) · sino · Console (Shield, só perfil.equipe) · avatar quadrado
    36, raio 9, fundo var(--base-texto), texto var(--base-cartao), inicial.
1.3 Botão do trilho: 40×40, raio 10, ícone 20. Ativo (pela área da rota, item 2): fundo var(--base-fill) e marcador
    3×20 px var(--base-texto) à esquerda. Dica com o nome no hover/foco. Área fora das liberadas: opacidade .38,
    dica "Não contratada", clique abre a página do 74 item 3.
1.4 Popovers do sino, do avatar, das dicas e da pílula: portal no body, z-[70], abrindo à direita do trilho e para
    cima (o sino com 380 px, o avatar com 240), sem sair da tela.
1.5 Conteúdo: margem esquerda 84 px; cartão com raio 16, borda e fundo var(--base-cartao), min-height 100vh − 20 px.
    Fundo da página = var(--base-conteudo): tire bg-[#FFFFFF] da raiz do app-shell e bg-[#F5F5F7] da raiz do
    workspace-shell. Não crie --base-app.
1.6 Topo do cartão, faixa de 44 px (sticky top-0 dentro da página): à esquerda a empresa (equipe: a pílula q
    restilizada, Building2 + nome + ▾, raio 999; cliente: Building2 + nome em cinza, sem botão); à direita o botão
    ⌘K ("Busque uma tela, um cliente ou pergunte") e o "?" (glossário).
1.7 < 1024 px (troque min-[821px] por lg): sem trilho; barra de 52 px no topo: ☰ · símbolo + "MotorCX" · sino ·
    avatar. O ☰ abre uma gaveta com os itens do trilho e os nomes (não contratadas com "Quero conhecer").
1.8 Aceite: nenhuma tela logada tem aside.mc-menu nem a barra antiga; um sino, um avatar, uma pílula; ⌘K funciona
    em toda tela; o contador do Suporte atualiza; voltar no navegador restaura a rolagem.

## 2. areaDaRota (area-rota)
Ordem: /console/* → console (inclusive produtos, fornecedores, qualidade, filtro-inteligencia) · /mensageria* →
mensageria · /relatorios* → relatorios · /jornada* → jornada · /empresa/auditoria → console se equipe sem empresa
na pílula, senão empresa · /empresa* → empresa · /suporte* → suporte · /inicio, /conta*, /docs*, /documentacao,
/assistente* → workspace · /fila /clientes /acoes /envios /orquestracao /personas /clusters /credores* /canais
/mapa /comite /painel /estrategias* → cobranca · qualquer outra (404, /cliente) → nenhuma (sem item marcado).
aplicarFrente('motorcob' | 'motorcli') só em cobranca e jornada (nunca escolherFrente(f, false)).
Aceite: a 404 e /cliente não marcam área nem trocam a frente; Console › Produtos marca Console.

## 3. Abas: constante ABAS (área · aba = rota; subabas entre parênteses; a ativa vem da rota)
cobranca · Lista do dia = /fila
cobranca · Clientes = /clientes
cobranca · Ações = /acoes
cobranca · Cargas = /envios
cobranca · Estratégia (Orquestração /orquestracao · Personas /personas · Segmentos /clusters · Carteiras /credores
  e /credores/:codigo/configuracoes · Canais e frases /canais, só editar_canais · Mapa da Esteira /mapa · Comitê
  /comite · Estratégias /estrategias*)
cobranca · Resultados (Painel /painel · Relatórios ↗ /relatorios?produto=orquestracao)
jornada · Visão geral = /jornada
jornada · Lista do dia = /jornada/lista
jornada · Cargas = /jornada/cargas
jornada · Estratégia (Momentos e fases /jornada/momentos · Mensagens /jornada/mensagens · Carteiras /jornada/carteiras)
mensageria · Campanhas = /mensageria/{c}/campanhas (e /nova, /:id)
mensageria · Lotes = /mensageria/{c}/lotes (e /:id; sem esta aba no WhatsApp)
mensageria · Respostas (Caixa /mensageria/atendimento · Radar /mensageria/radar)
mensageria · Templates = /mensageria/{c}/templates
mensageria · Listas = /mensageria/{c}/listas
mensageria · Resultados (Painel do canal /mensageria/{c} · Score /mensageria/{c}/score · Relatórios ↗)
mensageria · Configurações (Do canal /mensageria/{c}/config · Atendimento /mensageria/config/atendimento)
mensageria · (sem aba) /mensageria = escolha do canal
relatorios · Cobrança / Jornada / Mensageria = /relatorios?produto=… (liberadas por use-areas-liberadas)
relatorios · Meus arquivos = /relatorios?exportacao=1
empresa · Visão geral = /empresa · Contatos = /empresa/contatos · Pessoas e perfis = /empresa/pessoas
empresa · Integrações = /empresa/integracoes · Faturas = /empresa/faturamento · Contratação = /empresa/contratacao (equipe)
empresa · Auditoria = /empresa/auditoria
console · Clientes (Empresas /console · Saúde /console/saude · Implantação /console/implantacao · Carteiras /console/carteiras)
console · Suporte (Atendimento /console/atendimento · Assistente /console/assistente)
console · Financeiro (Faturamento /console/faturamento · Margem /console/margem)
console · Mensageria (Produtos e preços · Fornecedores e rotas · Qualidade · Filtro de inteligência)
console · Administração (Equipe /console/equipe · Auditoria /empresa/auditoria)
console · Sistema (E-mails /console/emails)
suporte, workspace: sem abas (Suporte mostra a lista de hoje, sem filtro).
Visual: aba = ícone 16 + nome (+ contador em pílula cinza); ativa com sublinhado 2 px var(--destaque). Subabas em
pílula logo abaixo (ativa: fundo var(--destaque-suave), borda var(--destaque)). < 1024 px: rolam na horizontal.
Permissões: aba ou subaba some sem a permissão que o item do menu antigo exigia.
Contadores só os que já existem: Console › Suporte/Atendimento (vermelho) e Clientes/Implantação (azul), os mesmos
do app-shell. Os demais ficam para o 77. Mensageria: as pílulas de canal (ke) ficam à direita, logo abaixo das abas.

## 4. Cabeçalhos duplicados (por moldura; os controles listados ficam)
- console-shell: sai o h1 "Console MotorCX"; a função e "Só a carteira · N empresas" vão para o subtítulo.
- jornada-shell: o cabeçalho f fica como cabeçalho da página, com o seletor Carteira (frente motorcli).
- mensageria-canal-layout: ficam o título, a pílula Simulação/Envio real e a faixa "Pedir envio real"; sai o rodapé
  "Trocar de canal" (o canal está nas pílulas).
- empresa-shell: saem as abas próprias (viram as do item 3); ficam o h1 da empresa, "Mais ações" e as ações da equipe.
- X (app-shell) e T (workspace-shell): mesmo estilo (rótulo da área em caixa alta, título 24, subtítulo, ação).
O ouro (--destaque, do 75a) só no botão principal do X/T e nas abas.

Aceite final, em 1440 e 390 px, claro e escuro, cliente e equipe: toda rota do menu antigo, inclusive as 15 do
Console, abre com uma aba (e subaba) marcada; nenhuma tela tem dois títulos; nada de rolagem dupla.
```
