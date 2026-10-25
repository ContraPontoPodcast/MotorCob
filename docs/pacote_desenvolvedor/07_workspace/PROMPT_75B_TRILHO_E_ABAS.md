# Prompt Horizons — 75b: moldura aprovada (lateral só de ícones, faixa de contexto e abas por área)

UX + CX, 25/10. Aprovado: modo "C · só ícones" do `produto-prototipo.html`. Só com o 75a no ar (all.css com --destaque).
```text
NÃO crie, altere ou apague tabelas, views ou políticas. Nada de CPF ou nome de devedor. Não mude rotas, ids, parâmetros
nem o conteúdo das telas. A PÁGINA (window) rola; a lateral fica fixa. Não ponha rolagem dentro de um cartão.

## 1. Lateral SÓ DE ÍCONES (não é o menu antigo: nada de grupos nem de itens de seção na lateral)
1.1 Tire o menu lateral antigo do app-shell (aside.mc-menu: "‹ Início", pílula da empresa, linha de botões de área,
    grupos, rodapé) e a barra do topo do assistente-gaveta. Antes, leve para a moldura nova, sem duplicar: o keydown
    do ⌘K e o evento motorcob:focus-busca; o contador do Suporte (chamados aguardando_cliente a cada 60 s +
    mc:suporte-visto); o sino de avisos; o menu do avatar; a pílula de troca de empresa da barra do topo. Ficam como
    estão: faixas de fatura/acordo, bloqueio por fatura, "não faz parte do plano", carregando, desativado e sem acesso.
    app-shell e workspace-shell usam a mesma moldura.
1.2 Lateral fechada (padrão): coluna de 44 px, position fixed à esquerda, SEM cartão, sem borda e sem fundo próprio
    (fica sobre var(--base-conteudo)). Botões de 36×36, raio 9, ícone lucide de 18 px, cor var(--base-texto-2).
1.3 Ordem e ícones (lucide): logo MotorCX (símbolo → /inicio) · Início House /inicio · Cobrança CircleDollarSign
    /fila · Jornada do Cliente Route /jornada · Mensageria MessagesSquare /mensageria · Relatórios FileChartColumn
    /relatorios · espaço · Empresa Building /empresa (um item só; as seções são abas da tela) · espaço · Suporte
    Headset /suporte, com o número "Aguardando você" em vermelho no canto · Console MotorCX ShieldCheck /console, só
    perfil.equipe · no pé: botão dos nomes ChevronsRight e o avatar (inicial; abre o menu do avatar de hoje).
1.4 Ativo (pela área da rota, item 3): fundo var(--base-fill) no botão e traço de 2 px var(--base-texto) colado à
    esquerda. Área fora das liberadas: opacidade .45 e o clique abre a página do 74 item 3 ("não faz parte do plano").
1.5 Dica: ao passar o mouse ou focar, o nome aparece à direita numa dica escura (#1D1D1F, texto branco 12,5 px),
    num portal no body com z-[70]. Popovers do sino, do avatar e da pílula: mesmo portal, abrindo à direita e para
    cima, sem sair da tela.
1.6 Botão dos nomes, SEM texto: só ChevronsRight, com aria-label e dica "Mostrar os nomes" / "Esconder os nomes".
    Aberta, a lateral passa a 192 px com ícone 20 + nome (texto cinza; ativo em negrito com o mesmo traço) e o ícone
    gira 180°. Guarde a escolha em localStorage mc-lateral-nomes ("1" aberta); padrão: só ícones.
1.7 Conteúdo: cartão à direita da lateral (raio 16, borda var(--base-borda), fundo var(--base-cartao), min-height
    100vh − 20 px), margem esquerda = largura da lateral + 10 px (44 ou 192) e SEM overflow-hidden (a faixa é sticky).
    Fundo var(--base-conteudo): tire bg-[#FFFFFF] da raiz do app-shell e bg-[#F5F5F7] da raiz do workspace-shell.
1.8 Topo do cartão, faixa de 44 px (sticky top-0): à esquerda a migalha "Área › Aba" em cinza e, para a equipe, a
    pílula da empresa (Building + nome + ▾, raio 999). À direita: ⌘K ("Busque uma tela, um cliente ou pergunte"), "?" e
    o sino.
1.9 < 1024 px (troque min-[821px] por lg): sem lateral; barra de 52 px no topo: ☰ · símbolo + "MotorCX" · sino ·
    avatar. O ☰ abre uma gaveta com os mesmos ícones E os nomes; na área aberta, as seções dela (abas) com recuo.
1.10 Aceite: nenhuma tela logada tem aside.mc-menu nem a barra antiga; a lateral fechada tem só ícones (nenhum texto
    visível) e nenhum item de seção; um sino, um avatar, uma pílula; ⌘K funciona em toda tela; o contador do Suporte
    atualiza; a escolha dos nomes volta igual depois de recarregar; voltar no navegador restaura a rolagem.

## 2. Início: atalhos com os mesmos ícones
Antes do "Para hoje", uma grade (cartões ≥ 170 px, borda, raio 14, ícone 22, nome negrito, descrição 12 cinza):
Cobrança "Lista do dia, réguas e carteiras" · Jornada do Cliente "Boas-vindas, ativação e retenção" · Mensageria
"Campanhas, lotes e respostas" · Relatórios "Os números de todas as áreas" · Empresa "Pessoas, faturas e integrações"
· Suporte "Seus chamados" · Console MotorCX "Clientes, financeiro e equipe" (só equipe). Não contratada: opacidade .5
e "Não contratada · Quero conhecer". Mesmos ícones do 1.3.

## 3. areaDaRota (area-rota)
/console/* e /empresas → console (inclusive produtos, fornecedores, qualidade, filtro-inteligencia) · /mensageria* →
mensageria · /relatorios* → relatorios · /jornada* → jornada · /empresa/auditoria → console se equipe sem empresa
na pílula, senão empresa · /empresa* → empresa · /suporte* → suporte · /inicio → inicio · /conta*, /docs*,
/documentacao, /assistente* → workspace (nenhum ícone marcado) · /fila /clientes /acoes /envios /orquestracao
/personas /clusters /credores* /canais /mapa /comite /painel /estrategias* → cobranca · qualquer outra (404,
/cliente) → nenhuma. aplicarFrente('motorcob' | 'motorcli') só em cobranca e jornada (nunca escolherFrente(f, false)).
Aceite: a 404 e /cliente não marcam área nem trocam a frente; Console › Produtos marca Console.

## 4. Abas: constante ABAS (área · aba = rota; subabas entre parênteses; a ativa vem da rota)
cobranca · Lista do dia /fila · Clientes /clientes · Ações /acoes · Cargas /envios
cobranca · Estratégia (Orquestração /orquestracao · Personas /personas · Segmentos /clusters · Carteiras /credores e
  /credores/:codigo/configuracoes · Canais e frases /canais, só editar_canais · Mapa da Esteira /mapa · Comitê
  /comite · Estratégias /estrategias*)
cobranca · Resultados (Painel /painel · Relatórios ↗ /relatorios?produto=orquestracao)
jornada · Visão geral /jornada · Lista do dia /jornada/lista · Cargas /jornada/cargas
jornada · Estratégia (Momentos e fases · Mensagens /jornada/mensagens · Carteiras /jornada/carteiras)
mensageria · Campanhas /mensageria/{c}/campanhas (e /nova, /:id) · Lotes /mensageria/{c}/lotes (e /:id; não no WhatsApp)
mensageria · Respostas (Caixa /mensageria/atendimento · Radar /mensageria/radar)
mensageria · Templates /mensageria/{c}/templates · Listas /mensageria/{c}/listas · (sem aba) /mensageria = canal
mensageria · Resultados (Painel do canal /mensageria/{c} · Score /mensageria/{c}/score · Relatórios ↗)
mensageria · Configurações (Do canal /mensageria/{c}/config · Atendimento /mensageria/config/atendimento)
relatorios · Cobrança / Jornada / Mensageria /relatorios?produto=… (liberadas por use-areas-liberadas) · Meus
  arquivos /relatorios?exportacao=1 · /relatorios/novo: área marcada, sem aba
empresa · Visão geral /empresa · Contatos /empresa/contatos · Pessoas e perfis /empresa/pessoas · Integrações
  /empresa/integracoes e /empresa/modulos · Faturas /empresa/faturamento · Contratação /empresa/contratacao (equipe)
  · Auditoria
console · Clientes (Empresas /console e /empresas · Saúde · Implantação · Carteiras /console/carteiras · Contatos do
  site /console/contatos-site)
console · Suporte (Atendimento /console/atendimento · Assistente) · Financeiro (Faturamento · Margem)
console · Mensageria (Produtos e preços · Fornecedores e rotas · Qualidade · Filtro de inteligência)
console · Administração (Equipe /console/equipe · Auditoria /empresa/auditoria) · Sistema (E-mails /console/emails)
suporte, inicio, workspace: sem abas.
Visual: aba = ícone 16 + nome (+ contador em pílula cinza), ativa com sublinhado 2 px var(--destaque); subabas em
pílula abaixo (ativa: fundo var(--destaque-suave), borda var(--destaque)); < 1024 px rolam na horizontal.
Permissões: aba ou subaba some sem a permissão que o item do menu antigo exigia. Contadores: só os que já existem
(Console › Atendimento em vermelho, Implantação em azul); o resto é do 77. Mensageria: as pílulas de canal que já existem à
direita, logo abaixo das abas.

## 5. Cabeçalhos duplicados (por moldura; os controles listados ficam)
- console-shell: sai o h1 "Console MotorCX"; a função e "Só a carteira · N empresas" vão para o subtítulo.
  jornada-shell: o cabeçalho próprio dele vira o cabeçalho da página, com o seletor Carteira (frente motorcli).
- mensageria-canal-layout: ficam o título, Simulação/Envio real e "Pedir envio real"; sai "Trocar de canal".
- empresa-shell: saem as abas próprias (viram as do item 4); ficam o h1, "Mais ações" e as ações da equipe.
- Cabeçalho de página do app-shell e o do workspace-shell (title, description, actions): mesmo estilo (rótulo da
  área em caixa alta, título 24, subtítulo, uma ação).
Ouro (--destaque, do 75a) só no botão principal desses cabeçalhos e nas abas. A lateral é neutra.

Aceite (1440 e 390 px, claro e escuro, cliente e equipe): toda rota do menu antigo, inclusive as 15 do Console, abre
com ícone e aba (e subaba) marcados; nenhuma tela com dois títulos; nada de rolagem dupla; faixas de fatura visíveis.
```
