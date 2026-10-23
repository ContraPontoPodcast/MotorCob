# Prompt Horizons — 73: navegação por áreas (Onda 1: o menu segue a rota, Mensageria com menu próprio, 404 com saída)

Versão final (UX + CX, 23/10/2026). Rode depois do SQL 45, do SQL 46 (ver_clientes e ver_painel no catálogo) e dos
prompts 71 e 72. Protótipo: `navegacao-prototipo.html`. Sem SQL próprio. Fora: tokens (CX-05) e empresa só Mensageria.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Nada de CPF ou nome de devedor em nenhuma tela. Não mude o
conteúdo das telas; só a moldura (topo, menu lateral, gaveta), os links abaixo, as faixas de bloqueio, as páginas de
erro e a aba inicial de Relatórios (item 3).

## 1. A rota define a área (uma função só)
Crie areaDaRota(pathname) e use-a no menu lateral, no tema (troque a função que hoje escolhe a cor) e na gaveta.
- /mensageria e /mensageria/* → "mensageria" · /jornada e /jornada/* → "jornada" · /relatorios e /relatorios/* →
  "relatorios" · /console/* → "console"
- /inicio, /empresa/*, /conta/*, /suporte/*, /docs/*, /documentacao, /assistente/* → "workspace" (sem menu lateral)
- /fila, /clientes, /cliente, /acoes, /envios, /orquestracao, /personas, /clusters, /credores/*, /canais, /mapa,
  /comite, /painel, /estrategias/* → "cobranca"
Cor: workspace e relatorios = neutro "MotorCX"; console = neutro, menos as telas da Mensageria no Console (como hoje).
O menu NUNCA olha a frente guardada. Ao abrir uma rota "cobranca" ou "jornada", sincronize a frente da sessão com
aplicarFrente('motorcob' | 'motorcli'), que só grava em sessionStorage. NUNCA use escolherFrente(f, false) nem
setFrente nessa troca: eles apagam a preferência (mc-frente e perfis.frente_preferida). escolherFrente só quando a
pessoa escolhe de propósito (login, Minha conta). Para a equipe, a frente da rota vence a troca automática pela pílula.
Frentes da pessoa: rpc minhas_frentes() pode vir como ["motorcob"] ou [{frente:"motorcob"}]; leia os dois
(typeof x === 'string' ? x : x.frente). Cliente sem a frente da rota → página do item 5 ("não faz parte do plano").
A equipe nunca vê essa página.

## 2. Menu lateral de cada área (claro, prompt 45)
Topo: "‹ Início" · nome da área com a cor dela · troca de área: botões só com as áreas contratadas + Relatórios (uma
vez só; tire o "Trocar para…" do rodapé). A troca de área é navegação: não grava preferência. Esconda itens sem
permissão, como hoje.
- Cobrança: Operação (Lista do dia /fila · Clientes · Ações · Enviar carga /envios) · Estratégia (Orquestração ·
  Personas · Segmentos · Carteiras /credores · Canais e frases /canais, só com editar_canais · Mapa da Esteira ·
  Comitê) · Resultados (Painel · Relatórios /relatorios?produto=orquestracao).
- Jornada do Cliente: Jornada (Visão geral /jornada · Lista do dia /jornada/lista · Enviar carga /jornada/cargas) ·
  Estratégia (Momentos e fases · Mensagens por momento · Carteiras /jornada/carteiras) · Resultados (Relatórios
  /relatorios?produto=jornada). Tire Mapa, Clientes e Painel (são telas da Cobrança).
- Mensageria (área própria; sai o bloco Mensageria dos menus da Cobrança e da Jornada): seletor de canal em pílulas
  (um canal só = sem seletor). Canal {nome} (Painel do canal /mensageria/{c} · Campanhas · Lotes, menos no WhatsApp
  · Templates · Listas · Configurações do canal /mensageria/{c}/config) · Atendimento (Respostas
  /mensageria/atendimento · Radar /mensageria/radar · Configurar atendimento /mensageria/config/atendimento) ·
  Resultados (Score de Entrega /mensageria/{c}/score, item único, fora do bloco do canal · Relatórios
  /relatorios?produto=mensageria).
- Relatórios: Por área (Cobrança ?produto=orquestracao · Jornada ?produto=jornada · Mensageria ?produto=mensageria,
  só as contratadas) · Ferramentas (Montar relatório, abre o modal que já existe).
Cobrança e Jornada, com Mensageria contratada: grupo "Atalho" com "Respostas dos clientes" → /mensageria/atendimento
(mantenha esse "to": é por ele que o contador de respostas acha o item). Item de outra área mostra "↗" à direita.
Item ativo = o de maior prefixo da rota (/mensageria/sms/lotes/9 ativa Lotes); em Relatórios, o do ?produto=.
Canais contratados = empresa_modulos.canais da linha modulo = 'mensageria' com ativo = true. Canal {c}: o da rota;
nas rotas sem canal (/mensageria, /mensageria/atendimento, /mensageria/radar, /mensageria/config/atendimento) e no
Assistente, o último usado se ainda contratado, senão o 1º contratado. NUNCA 'sms' como padrão.
/mensageria/{c} com canal não contratado: "O canal {nome} não está contratado." + botão para o 1º contratado.
/mensageria com um canal só vai direto para /mensageria/{c} (replace). Na lista de lotes, o link de cada lote é
/mensageria/{canal}/lotes/{id} (hoje /mensageria/lotes/{id} dá 404).

## 3. Áreas ▾, Início e Relatórios com a mesma regra
Áreas ▾ · equipe: todas as áreas da empresa da pílula, como hoje. Cliente: rpc numeros_areas() (só area e
contratada), lida uma vez por empresa e guardada; contratada → "Abrir ›", não → esmaecida com "Quero conhecer".
Relatórios aparece sempre que houver uma área contratada. Destinos (Áreas ▾, Início, troca de área, gaveta):
Cobrança /fila · Jornada /jornada · Mensageria /mensageria · Relatórios /relatorios. Dentro de uma área, o botão do
topo mostra o nome dela ("Cobrança ▾") marcado como atual.
Relatórios (única mudança dentro de uma tela): sem ?produto=, abre em Cobrança se a pessoa tem a frente motorcob,
senão Jornada (frente motorcli), senão Mensageria (módulo ativo). Não use empresa_modulos para Cobrança/Jornada.
Mantenha ?exportacao= funcionando (o sino usa).

## 4. Um corte só: 1024 px (lg)
Troque TODOS os min-[821px] (topo e gaveta) por lg, e o menu recolhido (Ctrl+B, mc-menu-recolhido, hoje 980 px)
só vale a partir de lg. ≥ 1024 px: topo completo + menu lateral fixo. < 1024 px: ☰ · MotorCX · busca · sino ·
avatar (< 600 px a busca vira ícone e o "?" sai). O ☰ abre UMA gaveta à esquerda, igual no Workspace e nas áreas:
Início · Áreas (contratadas; as outras com "Quero conhecer") · Empresa (Dados e contatos, Pessoas e perfis, Faturas,
cada um com a permissão de hoje) · Suporte (com o número) · e, dentro de uma área, uma linha e o menu da área (com o
seletor de canal). Fecha ao navegar, no × e no Esc. Sem rolagem lateral em 390 px.
Botão do Assistente: quando a tela tem botão fixo no mesmo canto (ex.: Orquestração, bottom-6 right-6), ele sobe
64 px para ficar acima dele, em qualquer largura.

## 5. Páginas de erro dentro da moldura (topo visível, sem menu lateral)
- Rota inexistente (rota coringa "*" dentro do layout logado; sem login → /login): "404" grande · "Esta página não
  existe ou mudou de endereço." · "Endereço: {rota}" · "Ir para o Início" (principal) · "Voltar" (history.back) ·
  link "Avisar o Suporte" (/suporte/novo?assunto=Link quebrado: {rota}).
- Área não contratada (só cliente): "{Área} não faz parte do plano da sua empresa." · "Quero conhecer" · "Ir para o
  Início".
- Sem permissão (troque o texto do RoleGate; aqui o menu lateral da área continua): "Seu perfil não abre esta
  tela." · "{Tela} é do perfil {perfis que têm a permissão: permissoes_catalogo + ajustes de permissoes_papel}. Você
  está como {perfil}. Quem libera é o Admin da sua empresa, em Empresa › Pessoas e perfis." · "Ir para o Início" ·
  "Ver o que meu perfil pode" (/conta?aba=perfil).

## 6. Bloqueio da empresa (faixa e cartão das áreas, rpc acesso_da_empresa)
- "Pagar agora" só com pode('ver_faturamento') E pode('pagar_faturas'). Sem as duas: no lugar do botão, "Quem paga as
  faturas é {nomes de quem tem papel admin em rpc pessoas_empresa}" ("o Admin da sua empresa" se vier vazio). Sem
  link para Pessoas e perfis.
- situacao 'suspensa' ou 'encerrada': faixa e cartão dizem "Acesso suspenso pela equipe MotorCX. Fale com o
  Suporte." + botão "Falar com o Suporte" (/suporte/novo?assunto=Acesso suspenso). Nunca "fatura vencida" nem Pagar.
- 'inadimplente' e acordo: os textos de hoje, com a regra do botão acima.

Confira em 1440, 900 e 390 px, claro e escuro, como Admin e Operação, com: cliente só Cobrança, cliente Cobrança +
Jornada (com Mensageria SMS e RCS) e equipe com a pílula da empresa. Em /mensageria/* o menu é sempre o da
Mensageria; Áreas › Cobrança abre com o menu da Cobrança; navegar entre áreas não muda a "Área que abre primeiro"
em Minha conta; /qualquer-coisa mostra a 404 com o topo; nenhum link do menu dá 404.
```
