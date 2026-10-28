# Prompt Horizons — 84: passo Estágios (estágios de cobrança por segmento)

UX, 28/10/2026. Rode depois do 83. Protótipo: passo 3 "Em que estágio?". O motor já aceita: cada estágio
novo é uma etapa de motor/etapas.py dentro de estrategias.definicao; as 5 fases do motor aparecem como
estágios da carteira. Na tela de Cobrança, a palavra é "Estágio" (a Jornada continua com "momentos").

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Grave só em estrategias.definicao da estratégia do
segmento nesta carteira (sem apagar as outras chaves), pelo Salvar de hoje. Nada de CPF ou nome de devedor.

## 1. Lista "Estágios de <segmento>" (coluna da esquerda) — ordem = prioridade
Legenda: "O cliente fica no 1º estágio em que se encaixa. Arraste para mudar." Regra do motor: uma fase
na lista "pega" quem está nela MESMO desligada (fica sem ação); uma etapa só pega quem está numa fase se
estiver ACIMA dela. Etapa com condição Situação = X abaixo da fase X: aviso "Este estágio nunca recebe
ninguém: suba-o acima de <fase>." Itens na ordem de
definicao.ordem_etapas (sem a chave: etapas primeiro, depois quebra, preventivo, cpc, giro, localizacao):
- etapas (definicao.etapas[]): nome;
- fases como estágios da carteira, com o nome de definicao.rotulos_fases[fase] ou, sem ele: localizacao
  "Ainda sem contato", cpc "Contatado (CPC)", giro "Sem contato após as tentativas", preventivo "Acordo em
  dia", quebra "Acordo atrasado". Sem selo "Padrão" nem "MotorCX".
Cada item: alça de arrastar, número, nome, "≈ N clientes hoje" (item 4) e chave liga/desliga. Arrastar e
↑↓ gravam ordem_etapas com todos os ids. "+ Estágio" no fim.

## 2. Editor do estágio
- Nome (até 40). Etapa: grava etapas[i].nome; id = nome em minúsculas sem acento, hífen no lugar de espaço,
  ^[a-z0-9][a-z0-9_-]{0,39}$, único e diferente de quebra, preventivo, cpc, giro, localizacao. O id é
  gerado só ao criar: renomear muda o nome, nunca o id (saídas e ordem apontam para ele). Fase: o nome
  vai para definicao.rotulos_fases {fase: nome} (só rótulo da tela; o motor ignora a chave).
- Ligado: etapa → etapas[i].ativo; fase → definicao.<fase>.ativo (cpc: definicao.cpc.ativo), as 5 iguais,
  inclusive "Acordo em dia" (preventivo).
- Fase: "Quem entra" é só leitura ("Situação do cliente = <nome>, regra do motor"); prazo e saídas mostram o
  resumo que o editor já calcula. Para outra regra, "+ Estágio".
- Etapa, "Quem entra": o MESMO editor de condições dos Segmentos; todas valem; pelo menos uma. Operadores:
  = != > >= < <= em nao_em contem vazio preenchido. Campos: colunas da carga, saldo, dias_atraso,
  qtd_contratos e o fato "Situação do cliente" (campo fase; valores localizacao, cpc, giro, preventivo,
  quebra, com os nomes acima). Linha fixa abaixo: "Situação do cliente é um fato que o MotorCX calcula pelos
  retornos e acordos. Você usa como condição; não edita."
  Mostre também, desabilitados, "Propensão a pagamento (fato)" e "Abordagem da persona (fato)" com o selo
  "Coletando · em breve": aparecem na lista, mas não podem ser escolhidos nem gravados.
- "Por quanto tempo": de/até (inteiros, de ≤ até, até − de ≤ 730) e "contando": da entrada neste estágio
  (entrada) · dos dias de atraso (atraso) · do vencimento da parcela (vencimento) · de uma data da carga
  (coluna + nome da coluna) → referencia {tipo, coluna}. Opcional: "Repetir a régua a cada N dias (2–60),
  M vezes (1–24)" → ciclo {dias, vezes}.
- "Quando sair": Quando der CPC / fechar acordo / pagar / No fim do prazo → "fica neste estágio" (não grava
  o evento; não vale para fim do prazo) · "sai da régua" (sai) · "volta ao geral" (padrao) · "vai para
  “<estágio>”" (etapa:<id>). Texto: "Volta ao geral = o 1º estágio em que o cliente se encaixar; se não
  houver nenhum, ele fica sem ação." → saidas {cpc|acordo|pagamento|fim_janela: destino}.
- Botões: "Montar a régua deste estágio" (passo 4) · "Apagar estágio" (só etapas; tira de ordem_etapas e
  das saídas que apontavam para ele).

## 3. Clientes sem estágio
Conte na estado_cliente (head count, sem baixar linhas) os clientes da carteira e do segmento
(cluster_atual = código do segmento), na_carga, com motivo_hoje começando por "sem ação: sem estágio",
"sem ação: a fase do cliente" ou "sem ação: acordo quebrado, mas a quebra" (os dois últimos são o texto antigo). Se > 0, aviso âmbar abaixo da lista:
"≈ N clientes sem estágio na última lista: ficam sem ação." + "Criar um estágio para eles" (cria etapa
"Todos os outros" com condição Situação do cliente em [as fases desligadas], logo ACIMA da 1ª fase desligada
na ordem, e abre o passo Régua: sem régua o motor ignora a etapa). Ao desligar uma fase sem outro estágio
que pegue essa situação, mostre na hora: "Quem está em <Situação> fica sem estágio." Nunca bloqueia salvar.

## 4. Prévia "≈ N clientes hoje"
Só quando TODAS as condições são de Situação do cliente (= ou em): some enquadramento.clientes da carteira,
do segmento e na_carga com estado LOC (localizacao), CPA+CPB (cpc), NCP (giro), PRE (preventivo), QBR
(quebra). Com qualquer outro campo: "prévia na próxima lista". Fases: a mesma soma do estado delas.

## 5. Validação (as regras do motor; sem elas a etapa é ignorada)
Pelo menos uma condição; > >= < <= só com número; de ≤ até; dias da régua dentro de de..até (com ciclo,
de 1 a N); ids únicos; destino etapa:<id> só
para estágio que existe. Etapa sem nenhum dia de régua: o motor ignora; avise "Estágio sem régua: o motor
ignora, e quem cairia nele vai para o próximo" e deixe salvar.

Aceite: um segmento mostra as 5 fases como estágios com nomes editáveis e as etapas, na ordem gravada;
arrastar muda ordem_etapas; criar estágio grava uma etapa válida (o motor não registra aviso de etapa
ignorada); Propensão e Abordagem aparecem como "Coletando · em breve" e não gravam; o aviso de clientes
sem estágio aparece com o número da última lista; as 5 fases desligam pela chave. 1440 e 390 px, claro e escuro.
```
