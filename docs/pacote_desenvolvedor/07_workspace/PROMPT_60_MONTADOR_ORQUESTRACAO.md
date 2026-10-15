# Prompt Horizons — 60: Montador em 3 passos e relatórios da Orquestração e da Jornada (complementa o 59)

Rode depois do prompt 59. Protótipo aprovado em 15/10/2026: `docs/homologacao/relatorios-prototipo.html`
(telas "Montar relatório" e "Orquestração").

```text
Plataforma do cliente (motorcob.online). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Montador (/relatorios/novo e "Ajustar"), passos 1 · 2 · 3 com prévia de 200 linhas a cada escolha
1. Sobre o quê: cartões de relatorio_bases (visivel, do produto da aba, módulo contratado): nome e descrição.
2. O que mostrar:
   - "Separar por": botões com os campos agrupáveis de relatorio_campos + "Semana" e "Mês" quando a base tem data
     (agrupar aceita 'semana' e 'mes').
   - "Números": caixas. Sempre "Quantidade" (contar) e "Soma de {rótulo}" de cada campo número. Taxas e razões
     prontas (métricas: {funcao, num, den, nome, rotulo, sentido}):
     · funil: Taxa de entrega (entregues ÷ enviados, maior_melhor) · Não entregues (menor_melhor) e Taxa de não
       entrega (nao_entregues ÷ enviados) · Taxa de resposta (respostas ÷ entregues) · Taxa de descadastro
       (descadastros ÷ entregues, menor_melhor) · Taxa de clique (cliques ÷ entregues) · e-mail: Taxa de bounce
       permanente e temporário (÷ enviados, menor_melhor), Taxa de abertura (aberturas ÷ entregues).
     · mensagens: Enviadas (soma de enviada), Taxa de entrega (entregue ÷ enviada), Taxa de não entrega
       (nao_entregue ÷ enviada), "Pessoas diferentes" (contar_distintos de id_cliente).
     · acoes_regua: Taxa de retorno (com_retorno ÷ acionamentos) · Taxa de CPC (cpcs ÷ acionamentos) · Custo por CPC
       (razao custo ÷ cpcs, menor_melhor) · Ações até o 1º CPC (razao acoes_ate_primeiro_cpc ÷ primeiros_cpc).
     Nas bases de entrega, "Não entregues e taxa de não entrega" vem marcado. Cada caixa mostra a conta embaixo.
   - Sem "Separar por" e sem números: lista linha a linha; marque as colunas e arraste para ordenar.
3. Filtros e salvar: "+ Filtro" → campo filtrável → valores existentes (lista com busca, como no prompt 59) →
   "é", "não é", "contém", "está vazio" (texto) ou "maior que", "menor que", "é" (número e data). Ordem: campo ou
   número + crescente/decrescente. Nome* e "Quem vê": Toda a empresa · Só para mim (visibilidade 'empresa' |
   'pessoal'). Salvar → insert/update relatorios_modelos {empresa_id, nome, descricao, categoria (nome da base),
   base, colunas, agrupar, metricas, filtros:{campos}, ordem, visibilidade}. O período não é salvo.
Erro da rpc vira a frase do banco ("não dá para separar por …"), nunca o texto técnico.

## 2. Aba Orquestração (MotorCob) e Jornada (MotorCli)
Mesma lista, mesma tela aberta e mesmo montador do prompt 59, com as bases acoes_regua, carteira_hoje, movimento,
indicadores, evolucao e jornada. Categorias: Régua · Carteira · Acordos e resultado · Jornada.
- Filtros em botões: Carteira, Estratégia, Segmento, Persona, Fase da régua, Canal e Safra (o que a base tiver).
  Situações e fases já vêm com o nome da tela ("CPC · em negociação", "Acordo em dia", "Localização").
- Números do topo de "Quantos CPCs a régua gerou…": Acionamentos, Com retorno (taxa), CPCs (taxa), Custo por CPC
  (R$, menor_melhor), Ações até o 1º CPC, com a variação do prompt 59. Nota: "Taxa de CPC = CPCs ÷ acionamentos.
  Custo pelo preço de cada canal no período."
- "Como a carteira se moveu?": tabela De · Para · Clientes · "% de quem estava em De" (clientes ÷ soma dos clientes
  com o mesmo De).
- Carteira hoje (foto_do_dia): sem período; texto "Como está hoje · para comparar no tempo, use Evolução da
  carteira".
- Evolução da carteira: período livre; o relatório pronto "Como a carteira evoluiu mês a mês?" usa só o fechamento
  de cada mês (filtro fechamento = Sim, já salvo nele); gráfico de colunas empilhadas por situação. Nota: "A foto
  diária fica 90 dias; o fechamento de cada mês fica para sempre. O histórico começa no dia em que a foto foi
  ligada."
- Indicadores por safra: linha a linha (os % já vêm calculados pelo motor; não some porcentagens).
- Nunca mostre o cliente um a um nestas bases.

Confira em 1440 e 390 px, claro e escuro.
```
