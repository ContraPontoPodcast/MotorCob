# Prompt do site — Orquestração: espaço para as réguas e "Como vai funcionar" em visão própria

Só layout. Sem SQL. Cole no Hostinger Horizons e publique:

---

```text
Reorganize a página Orquestração. SÓ LAYOUT: não mude gravações em estrategias.definicao, tabelas, views,
políticas, nem a lógica de arrastar, frases, ON/OFF ou personas.

Problema hoje: a tela tem 3 colunas (segmentos | réguas | "Como vai funcionar"). Em 1440 px as réguas ficam com
~380 px e mostram só o D+1 e metade do D+2; o "Como vai funcionar" é um texto corrido apertado à direita e o
botão Salvar fica escondido no fim dessa coluna.

## 1. Réguas com a largura toda
- Remova a coluna da direita (xl:grid-cols-[minmax(0,1fr)_300px]). O conteúdo da estratégia usa 100% da largura.
- Lista de segmentos da esquerda: vira recolhível. Botão "◀ Segmentos" no topo; recolhida, mostra só uma faixa
  de 56 px com as iniciais/cores dos segmentos (tooltip com o nome) e o segmento atual destacado. Lembrar no
  localStorage ("motorcob.orq.segmentos"). Em telas < 1600 px começa recolhida.
- Paleta de canais (WhatsApp, RCS, SMS, E-mail, Agente virtual, Discador, Enriquecimento, Melhor canal da
  persona, personas da carteira): vira uma BARRA FIXA no topo da área da estratégia (position: sticky; top: 0;
  z-10; fundo branco com sombra leve), em uma linha com rolagem horizontal se não couber. Assim dá para arrastar
  para qualquer dia sem subir a página.
- Grade dos dias: cartões de dia com largura fixa de 168 px, todos os dias numa linha só; quando não couber,
  rolagem horizontal com setas ‹ › nas bordas e sombra indicando que há mais dias. A coluna de raias (Público
  geral, personas) fica fixa à esquerda (sticky left) enquanto os dias rolam.

## 2. Barra de ações fixa embaixo
Barra fixa no rodapé da área da estratégia (sticky bottom), sempre visível:
- À esquerda: "Alterações não salvas" (ponto âmbar) quando houver mudança; senão "Tudo salvo".
- Contadores: "N dias com ação · N ações sem frase · N avisos" (avisos = os pontos âmbar das faixas; clicar
  rola até a primeira faixa com aviso e a abre).
- À direita: "Começar do playbook MotorCob" (secundário) e "Salvar" (primário). Ctrl/⌘+S também salva.

## 3. Duas visões: "Desenhar" e "Visão geral"
No topo da estratégia (ao lado do nome), um seletor segmentado: [ Desenhar | Visão geral ]. Lembrar a escolha.
- Desenhar: a tela de hoje (faixas com as réguas), já com os itens 1 e 2.
- Visão geral (substitui o "Como vai funcionar"), largura total, somente leitura:
  · Uma linha do tempo por faixa, em blocos empilhados: Cliente novo, Deu CPC, Não CPC, Preventivo, Quebra.
    Faixa desligada aparece em cinza com "Desligada".
  · Colunas = dias (D+1, D+3… / G-dia1… / D-3… D0 / D+1…); em cada dia, chips dos canais na ordem com o modo
    entre eles ("senão", "junto", "reserva"), o 💬 da frase (azul com frase, cinza sem, vermelho desativada) e,
    abaixo, uma linha por persona com raia própria naquele dia (bolinha da cor da persona + canais).
  · Deu CPC: "Canal do CPC (Hot)" → "Reserva 1 → 2 → 3", tentativas por canal, CPC A a cada N dias, CPC B a
    cada N dias, e o reforço junto.
  · No topo da visão: cartões-resumo — dias com ação, canais usados (chips), ações sem frase, personas com raia,
    avisos.
  · Clicar num dia (ou num canal) volta para "Desenhar", abre a faixa certa, rola até aquele dia e pisca o cartão
    por 1,5 s.
  · Botão "Imprimir / PDF" (window.print com CSS de impressão: só a visão geral, fundo branco).
- O texto explicativo que hoje está no topo do "Como vai funcionar" vira um ícone (i) com tooltip ao lado do
  seletor de visão.

## 4. Responsivo
- < 1024 px: segmentos viram um select no topo; a paleta continua sticky; Visão geral empilha os dias na vertical.
- Nada pode cortar o nome dos canais nos chips (use truncate com tooltip só em nomes de persona).
```
