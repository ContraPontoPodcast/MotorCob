# Prompt do site — Orquestração: corrigir o layout (página cabe na tela, "Como vai funcionar" embaixo)

Só layout. Sem SQL. Substitui o prompt anterior de layout da Orquestração. Cole no Hostinger Horizons e publique:

---

```text
Corrija o layout da página Orquestração. SÓ LAYOUT: não mude gravações em estrategias.definicao, tabelas,
views, políticas, nem a lógica de arrastar, frases, ON/OFF, personas ou Replicar.

Problemas de hoje: (a) a página fica mais larga que a tela (rolagem lateral na página inteira: a linha de dias
das réguas empurra o cartão da Estratégia para a direita); (b) os segmentos recolhidos viram uma caixa larga e
vazia com botõezinhos no meio; (c) a barra de Salvar fica flutuando no meio da faixa Cliente novo, por cima das
réguas; (d) o "Como vai funcionar" virou uma aba "Visão geral" separada.

## 1. A página sempre cabe na tela (reenquadrar)
- Nenhum elemento pode passar da largura da área de conteúdo: em todos os contêineres flex/grid da página use
  min-w-0 e max-w-full; no <main> da página, overflow-x: hidden.
- A ÚNICA rolagem lateral permitida é dentro da linha de dias de cada régua: o contêiner dos dias tem
  overflow-x: auto, width: 100%, e os cartões de dia (168 px) ficam dentro dele. Mantenha as setas ‹ › e a
  coluna de raias (Público geral, personas) fixa à esquerda.
- Critério: em 1280, 1440 e 1920 px, document.documentElement.scrollWidth === clientWidth (sem barra lateral).

## 2. Segmentos: uma linha de cartões no topo (sem caixa vazia)
- Remova o modo "recolhido" com iniciais. Os segmentos ficam num cartão de largura total, logo abaixo do texto de
  ajuda, como uma linha de "pílulas" que quebra linha: [código] Nome · N clientes. A pílula do segmento atual fica
  preenchida (#0F4C5C, texto branco); as outras com borda. Clicar troca o segmento. "+ Novo segmento" no fim.
- Altura do cartão = só o necessário (sem espaço vazio).

## 3. Salvar volta para o cabeçalho da Estratégia
- Remova a barra flutuante do meio da página.
- No cabeçalho do cartão Estratégia (linha do nome/seletor, à direita, ao lado de Replicar e Exportar):
  "Começar do playbook MotorCob" (secundário) e "Salvar" (primário).
- Com alterações não salvas: o Salvar ganha um ponto âmbar e o texto "Salvar alterações"; e aparece um botão
  flutuante "Salvar" fixo no canto inferior direito da tela (position: fixed; bottom: 24px; right: 24px),
  pequeno, que some quando está tudo salvo. Ctrl/⌘+S salva.
- Os contadores (dias com ação · ações sem frase · avisos) vão para o resumo do "Como vai funcionar" (item 4).

## 4. "Como vai funcionar" no fim da página, recolhível
- Remova o seletor "Desenhar | Visão geral" e o ícone (i). A tela volta a ser uma só.
- Depois da última faixa ("Prioridade dos telefones") e antes das "Travas que valem sempre", um bloco
  "Como vai funcionar" com o MESMO padrão das faixas: cabeçalho inteiro clicável, seta, resumo de uma linha sempre
  visível ("N dias com ação · N ações sem frase · N avisos · canais: WhatsApp, SMS, Discador…"), fechado por
  padrão, entra no Expandir/Recolher tudo e na memória do navegador.
- Aberto, largura total, em grade de cartões (2 colunas em ≥ 1280 px, 1 coluna abaixo), um cartão por faixa:
  Cliente novo, Deu CPC, Não CPC, Preventivo, Quebra. Em cada cartão, uma lista por dia:
  "D+1  WhatsApp → senão SMS  💬" e, embaixo, as raias de persona daquele dia em texto menor
  ("● Sênior (60+): Discador"). Faixa desligada: cartão cinza "Desligada neste segmento".
  Deu CPC: "Canal do CPC (Hot) → Reserva 1 → 2 → 3 · 3 tentativas por canal · CPC A a cada N dias · CPC B a cada
  N dias · Reforço: …".
- Clicar numa linha de dia rola até aquele dia na régua (abrindo a faixa) e pisca o cartão do dia por 1,5 s.
- Botão "Imprimir / PDF" no canto do bloco aberto.

## 5. Mantém
Paleta de canais fixa no topo ao rolar (compacta, uma linha), faixas recolhíveis pelo cabeçalho inteiro,
Frases desta faixa, Expandir tudo / Recolher tudo.
```
