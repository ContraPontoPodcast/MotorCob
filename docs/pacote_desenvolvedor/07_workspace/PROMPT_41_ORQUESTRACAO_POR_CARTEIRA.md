# Prompt Horizons — 41: Orquestração por carteira (bloco 3)

Rode depois do SQL 31. Protótipo aprovado: `docs/homologacao/bloco3-orquestracao-prototipo.html`.

```text
Plataforma › Estratégia › Orquestração (motorcob.online). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Carteira no topo
Seletor "Carteira" (botões) acima de tudo: "Tudo abaixo é desta carteira: segmentos, estratégia, etapas e travas."
Segmentos da carteira: view segmentos_em_uso filtrada por credor_id e vinculado = true. A estratégia que vale
nesta carteira é a coluna estrategia_id (já resolvida pelo banco; nunca use clusters.estrategia_id).

## 2. Estratégia compartilhada
Se compartilhada_com não for vazio, aviso âmbar acima do editor:
"Esta estratégia também vale na carteira {compartilhada_com}. Mudar aqui muda lá."
Botões: "Separar só para esta carteira" → rpc separar_estrategia(segmento, carteira) (devolve o id da cópia;
recarregue e siga editando a cópia) · "Editar para as duas" (fecha o aviso; Salvar grava no id atual).
Selo no segmento: "Própria desta carteira" quando estrategia_propria = true.

## 3. Barra única de ações (uma linha, acima do editor)
Esquerda: vistas em controle segmentado — Desenho da esteira · Etapas e fases · Travas · Visão geral.
Direita: estado ("Tudo salvo" verde / "Alterações não salvas" âmbar) · "Copiar de outra carteira" ·
"Mais ▾" (Começar do playbook MotorCob, Montar esteira pelas personas, Imprimir / PDF, Reenquadrar agora) ·
"Salvar" (botão principal, cor da área). Some com os botões espalhados de hoje.

## 4. Copiar de outra carteira
Janela: Carteira de origem, Segmento de origem e o que copiar (Régua das fases, Etapas, Orçamento e prioridade,
Travas, Frases, Raias de personas — só as personas que existem nesta carteira). Copia para o editor SEM salvar:
"Revise e clique em Salvar." Ao salvar uma cópia: rpc separar_estrategia(segmento, carteira, definicao) — sempre
cria estratégia nova só desta carteira; a de origem não muda.

## 5. Etapas e fases: fases do motor com orçamento, prioridade e travas
As fases (Cliente novo, CPC, Não CPC, Acordo · antes do vencimento, Acordo · parcela vencida) ganham, ao lado
das etapas próprias, o mesmo painel de Orçamento por canal e Travas do prompt 34, gravando na definição:
definicao.<fase>.orcamento e definicao.<fase>.travas (fase = localizacao, cpc, giro, preventivo, quebra),
no mesmo formato das etapas ({"intervalo_horas", "acoes_dia", "de", "ate"}).

## 6. Vista Travas: tabela estratégia × fase
Linhas = travas; coluna "Estratégia" (vale para todas as fases) + uma coluna por fase. Intervalo entre ações,
Ações por dia e Horário aceitam valor próprio por fase: clique na célula, digite, ela fica com o selo
"desta fase" (e "voltar ao da estratégia"). As outras travas (domingo, por semana, discador, Não perturbe,
freio do WhatsApp) mostram só o valor da estratégia. Rodapé fixo: "Faixas de segurança valem sempre: 08:00–20:00,
intervalo mínimo de 12 h, freio do WhatsApp até 5%."

## 7. Visão geral
Como hoje (linha do tempo por faixa, somente leitura). No topo: a carteira e, por fase, o orçamento e as travas
próprias quando houver.

Nomes: use os do glossário (Cliente novo, Não CPC, 1º ciclo, CPC · sem resposta…), nunca LOC, G1, RE, T1.
Confira em 1440 e 390 px.
```
