# Prompt Horizons — Site vivo: carrossel automático e números em movimento

Rode depois do carrossel escuro (PROMPT_CARROSSEL_ESCURO.md). Só muda o site público em "/". A animação usa
apenas os dados fictícios do site; a plataforma (/inicio) continua mostrando dados reais, parados.

```text
No site público "/", dê vida ao carrossel #plataforma e às personas. Não mude textos, cores, login, plataforma
ou banco. Tudo abaixo vale só para os dados fictícios do site.

1. CARROSSEL PASSA SOZINHO
- A cada 6 segundos vai para o próximo slide; depois do 6º volta ao 1º.
- O ponto do slide atual (a pílula de 24px) enche da esquerda para a direita em champanhe #C9A35A durante os 6 s
  (animação linear de scaleX 0→1); recomeça a cada troca de slide.
- Pausa enquanto o mouse está sobre o carrossel, quando algo dentro dele recebe foco do teclado, quando a aba
  fica escondida (visibilitychange) e quando o carrossel está menos de 40% visível (IntersectionObserver).
  Ao voltar, continua de onde parou (o ponto não reinicia).
- Depois de seta, ponto, teclado ou arraste, o tempo recomeça do zero no slide escolhido.
- Botão redondo 36px à direita da seta "›" (fundo rgba(255,255,255,.12), ícone #F5F5F7): ícone de pausa (duas
  barras) com aria-label "Pausar a passagem automática"; clicado, vira ícone de play com "Continuar a passagem
  automática" e aria-pressed="true". Pausado pelo botão, nada passa sozinho até clicar de novo.

2. LISTA DO DIA DO SLIDE 01 SE MEXE (a cada 2,8 s, só com o carrossel visível e não pausado pelo botão)
- Carteira avaliada fica fixa em 2.600. Encerrados (não aparecem) fixos em 79.
- Esteira D+5 oscila perto de 324 (±8%), Esteira hoje perto de 221 (±10%), Sem contato válido perto de 107 (±12%).
  Passo de cada sorteio: até 1/2,5 da faixa. Sem telefone válido = Sem contato − 15.
- Com ação hoje = 2.600 − 79 − D+5 − hoje − Sem contato (a soma sempre fecha 2.600).
  Fora por regra da esteira = D+5 + hoje.
- Percentuais = valor ÷ 2.600, uma casa ("71,7%"). Barras das linhas = valor ÷ Com ação hoje.
- Números CONTAM até o valor novo em 0,9 s (ease-out), sempre em formato brasileiro (1.872); barras com
  transition width .9s.

3. PERSONAS VIVAS (#personas-site, a cada 2,6 s, só com a seção visível)
- Acima dos cards, centralizado: bolinha verde #34C759 de 7px pulsando (sombra que expande e some em 2 s) +
  "Atualizando · dados fictícios" (13px #6E6E73) + botão pílula "Pausar" (#F2F2F7, 26px). Pausado: bolinha
  #AEAEB2 parada, texto "Pausado · dados fictícios", botão "Continuar" (aria-pressed="true").
- Em cada card, a partir dos valores de base:
  maturidade oscila ±6 pontos (passo até 2,5; inteiro); clientes ±4% (passo até 1,2%; inteiro);
  CPC de cada canal ±6% do próprio valor (passo até 2,5%; uma casa decimal).
  Com ±6% a ordem dos canais nunca muda: o "★ melhor" e o "2º" continuam os mesmos e na cor do canal.
- O anel anda junto: stroke-dasharray "(M/100*251.3) 251.3" com transition .9s, e aria-label "Maturidade M de 100".
- Números contam até o valor novo em 0,9 s; barras do ranking com transition width .9s (largura = CPC ÷ maior CPC
  do card).

ACESSIBILIDADE E DESEMPENHO
- Com prefers-reduced-motion: nada passa sozinho, nada oscila, e o botão de pausa e a faixa "Atualizando" somem.
- Atualize só textos, larguras e atributos; não redesenhe os cards (as transições precisam continuar suaves).
- Os números não são lidos em voz alta a cada mudança (aria-live="off" na área das personas).
```
