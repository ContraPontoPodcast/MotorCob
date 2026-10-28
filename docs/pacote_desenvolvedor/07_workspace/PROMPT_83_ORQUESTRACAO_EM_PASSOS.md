# Prompt Horizons — 83: Orquestração em passos (Carteira → Segmentos → Estágios → Régua → Revisar)

UX, 28/10/2026. Rode depois do 82. Protótipo: `ux/criacao-simples-prototipo.html`, aba Orquestração.
Este prompt monta a moldura dos passos e os passos 1 e 2. Estágios (84) e Régua/Revisar (85) vêm depois.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Reaproveite os componentes que já existem: o
formulário de segmento da tela /clusters (condições e ordem), o aviso de estratégia compartilhada e o botão
"Separar só para esta carteira", e o editor de raias da Orquestração. Não mude regras nem gravações deles.
Nada de CPF ou nome de devedor.

## 1. Moldura dos passos (topo da /orquestracao, abaixo das abas)
Cinco cartões clicáveis, em linha (2 colunas abaixo de 1024 px):
1 "De quem?" Carteira · 2 "Quem?" Segmentos · 3 "Em que estágio?" Estágios · 4 "O que fazer?" Régua ·
5 "Pronto?" Revisar e salvar. Cada cartão mostra número, pergunta, título e uma linha de estado:
- 1: nome da carteira.
- 2: "N segmentos" ou "falta criar".
- 3: "N estágios" (ou "falta em N segmentos"); com clientes sem estágio: "≈ N sem estágio" (prompt 84).
- 4: "N de M estágios com régua".
- 5: "falta salvar" / "salvo".
Passo atual: borda var(--destaque). Passo completo: círculo com ✓. Estado na URL: ?passo=carteira|
segmentos|estagios|regua|revisar (padrão: estagios se a carteira já tem estratégia; senão segmentos), e
?carteira=<id>&segmento=<id> quando houver. Ao abrir com ?carteira=<id> diferente da carteira do contexto,
chame o selectCredor(<id>) de hoje (o mesmo que o seletor usa); o parâmetro ?credor=<codigo> de hoje continua. O botão do cabeçalho é "Revisar e salvar" (vai ao passo 5).
O indicador "Alterações não salvas" e o Salvar continuam como hoje (nada grava sozinho).

## 2. Passo 1 — Carteira
Cartões das carteiras da empresa (as que a pessoa vê hoje): nome, tipo, clientes na carga e "N segmentos ·
N estágios" ou "vazia". Escolher troca a carteira do contexto (o mesmo seletor de carteira de hoje).
Texto: "Cadastrar carteira nova fica em Configurações › Carteiras." Botão "Continuar: quem vamos cobrar?".

## 3. Passo 2 — Segmentos (Quem?)
Lista dos segmentos vinculados à carteira (segmentos_em_uso), na ordem de hoje: nome, condições em chips,
clientes (soma da view enquadramento por cluster na carteira, na_carga), e o estado da estratégia:
"estratégia própria" · "compartilhada com N carteiras" (com o aviso e "Separar só para esta carteira" de
hoje) · "sem estratégia própria" (abre os 3 caminhos do prompt 82). Botão "Estágios" leva ao passo 3 com o
segmento escolhido.
"+ Segmento" abre o formulário de segmento de hoje com esta carteira já marcada.
Editar um segmento: antes de salvar, mostre "Este segmento é da empresa e está em N carteiras: mudar
condições ou ordem muda em todas." (N = vínculos em segmentos_em_uso).
Carteira sem segmento: os 3 caminhos do prompt 82 (Criar do zero · Copiar de outra carteira · Começar de
um modelo). "Montar pelas personas" não aparece mais como caminho de início.

## 4. Seletor de segmento nos passos 3 e 4
Fileira de botões com os segmentos da carteira (nome + clientes); o escolhido define a estratégia editada
(segmentos_em_uso.estrategia_id daquele segmento nesta carteira). Título dos passos: "Estágios de
<segmento>" e "O que fazer em “<estágio>”?".

## 5. Permissões
Editar: as de hoje (editar_orquestracao; Admin e Planejamento). Segmentos: as de hoje da tela /clusters.
Operação e quem só vê: passos visíveis, sem botões de criar, separar, salvar ou arrastar.

Aceite: /orquestracao abre nos passos com o estado de cada um; /clusters cai no passo Segmentos; criar e
editar segmento usa o formulário de hoje e avisa "usado em N carteiras"; o aviso de compartilhada e
"Separar só para esta carteira" continuam funcionando; nenhum dado é gravado ao trocar de passo; nada de
rolagem lateral em 390 px. Confira em 1440 e 390 px, claro e escuro, como Admin e Operação.
```
