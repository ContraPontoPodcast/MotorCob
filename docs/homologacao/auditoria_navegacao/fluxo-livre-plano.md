# Fluxo livre: plano de produto e de motor

UX, 25/10/2026. Protótipo: `fluxo-livre-prototipo.html`. Este documento é proposta e não autoriza nada.
Não traz SQL nem código: diz o que muda, onde muda e em que ordem. Os nomes de arquivo e de função vêm da
leitura de /home/user/motorcob (somente leitura).

## 0. Em uma frase

Hoje a estratégia é uma **esteira**: faixas fixas (Cliente novo, Deu CPC, Não CPC, Preventivo, Quebra), cada
uma com passos por dia, e as transições entre elas ficam no código. O **Fluxo livre** troca isso, só nas
carteiras que escolherem, por um **grafo** que a empresa desenha: Entrada, Enviar, Esperar, Condição,
Dividir %, Mudar momento e Sair. Travas, faixas de segurança, LGPD e a hierarquia de acordo continuam no
motor e o desenho não consegue desligá-las.

## 1. Como o motor decide hoje (o que o fluxo precisa respeitar)

- **motor/marcacao.py · `processar_dia`**: uma vez por dia, para cada cliente, aplica bloqueio, revisão de
  cluster, retornos do dia (`_aplicar_retornos`), acordo (`_aplicar_acordo`) e tempo (`_aplicar_tempo`).
  As transições estão escritas no código: contato vira CPA; sem resposta na negociação vira CPB; esgotou os
  canais vira NCP com re-enriquecimento (`_ir_para_giro`); giro esgotado fica pausado até chegar contato
  novo (`reativar_apos_enriquecimento`); quebra sem pagamento volta ao estoque como CPA. O estado vira a TAG
  `SAFRA-CLUSTER-ESTADO-CANAL-CICLO`, e cada mudança vai para a trilha.
- **motor/fila.py · `_passo_do_dia`**: a partir do estado, escolhe a faixa e o dia (QBR > PRE > recência >
  LOC > NCP > CPA/CPB), lê os passos da régua do cluster (`regua.para(cluster)`) e devolve as ações.
  `gerar_fila` aplica certificação, freio do WhatsApp, capacidade e recência (`_recencia_ok`, 48 h).
- **motor/estrategia.py · `validar_estrategia` / `normalizar` / `raia` / `resolver`**: validam e resolvem
  as ações `{canal, modo, contatos, numeros, personas, mensagem}` (modos sempre, senão, junto e reserva).
- **motor/travas.py · `ler`**: lê as travas da definição e impõe as faixas de segurança (08:00–20:00,
  intervalo de 12 h no mínimo e freio do WhatsApp de até 5%), mesmo com a trava desligada.
- **motor/etapas.py**: já existe uma primeira forma de "grafo". São etapas próprias, com condições de entrada,
  janela de dias, passos, `saidas` (`padrao`, `sai` ou `etapa:<id>`), ciclo, orçamento e travas, e uma
  `ordem_etapas` de prioridade. O estado delas fica em `<estado>/etapas.json`. **É a ponte natural** e o
  Fluxo livre deve crescer a partir daqui, não ao lado.
- **motor/jornada.py + regras/jornada.json** (MotorCli): momentos com hierarquia, recência de 48 h e
  isenções. É o mesmo padrão e a mesma solução valem para a frente de Jornada numa fase posterior.
- **Estado**: `rodar_dia.py` grava `estados.json` (troca atômica), `trilha.csv` e `escolhas.csv`.
- **Banco**: `estrategias.definicao` (objeto JSON); a estratégia chega ao cliente por
  `clusters.estrategia_id` e `credores.estrategia_id`; o segmento vale por carteira em `segmentos_carteira`.

## 2. O que muda no motor

1. **Novo formato na definição, versionado.** Na mesma `estrategias.definicao` entra um bloco opcional de
   fluxo: nós (tipo, posição na tela, parâmetros) e ligações (de qual saída para qual nó), com número de
   versão. A ação do nó Enviar usa **o mesmo formato de ação de hoje** (canal, modo, contatos, números,
   personas, mensagem) e passa pelas mesmas funções de estrategia.py. Assim, senão, junto, reserva, personas
   e frases continuam valendo sem regra nova.
2. **Validador do fluxo** (novo módulo ao lado de estrategia.py e etapas.py). Recusa salvar quando há:
   - nó sem saída;
   - Entrada ausente ou repetida;
   - ciclo sem Esperar;
   - Esperar menor que o intervalo mínimo;
   - horário fora de 08:00–20:00;
   - Dividir % que não soma 100;
   - Mudar momento para um momento que não existe;
   - nó inalcançável.

   O protótipo já mostra esses erros. A regra vale no site e no motor (o site avisa, o motor corta), como
   as travas já funcionam hoje.
3. **Posição do cliente no fluxo.** O `EstadoCliente` ganha "nó atual, desde quando e próxima avaliação".
   Esperar marca a data em que o cliente volta a andar; Condição lê os sinais que o motor já tem (retorno do
   dia, CPC, acordo, pagamento, bloqueio, contato novo).
4. **Execução diária.**
   - `processar_dia` continua aplicando bloqueio, acordo e retornos ANTES do fluxo.
   - Em seguida, para quem está num fluxo, um passo novo anda pelo grafo até parar num Esperar ou num
     Enviar do dia. São no máximo N nós por dia, para que um erro de desenho não vire laço infinito.
   - O Enviar entra na fila por `_passo_do_dia`, que hoje escolhe a faixa e, para essas carteiras, passa a
     ler o nó. Toda a parte de baixo (`gerar_fila`, certificação, freio, capacidade e recência) fica igual.
5. **Mudar momento** grava o estado do motor (LOC, CPA, CPB, NCP), a TAG e a trilha com "por fluxo · nó X".
   Com isso relatórios, KPIs e extrato continuam funcionando. O CICLO da TAG passa a ser o nó (por exemplo
   `F3`) enquanto o cliente está no fluxo.
6. **O que o fluxo NÃO decide** (fica no motor, por cima do desenho):
   - bloqueio e LIQ;
   - a hierarquia QBR > PRE > COL > CPA > CPB > LOC > NCP: acordo e quebra tiram o cliente do fluxo e ele
     volta pela Entrada correspondente ou pelo Sair "volta ao padrão";
   - opt-out, Não Perturbe, contato de terceiro e inválido;
   - travas e faixas de segurança, recência entre ações e pausa entre carteiras.
7. **Dividir %** precisa ser determinístico por cliente (sorteio fixo pelo ID), para que o mesmo cliente
   caia sempre no mesmo braço e o teste A/B seja medível.
8. **Simulação.** Hoje existe `previsao` em fila.py (7 dias). A simulação do fluxo roda o mesmo caminho
   sobre a carteira real com taxas históricas por canal (`jornada_resultados`, `retorno_canal`) e não gera
   envio. Os números do protótipo são fictícios.
9. **regras/**: `regua.json` ganha o "modelo padrão MotorCX" em forma de fluxo, como referência para a
   conversão. `jornada.json` fica como está até a fase 5.

## 3. O que muda no banco (descrição, sem SQL)

- **Estratégia:** o fluxo vai dentro de `estrategias.definicao`, versionado. Hoje a definição é sobrescrita
  ao salvar, e o fluxo exige guardar **as versões publicadas** (histórico por estratégia, com quem publicou
  e quando), porque um cliente pode estar num nó que a versão nova apagou.
- **Modo por carteira:** um campo "forma da estratégia: esteira ou fluxo" na carteira (credores) ou na
  ligação segmento × carteira. Padrão: esteira.
- **Posição dos clientes:** hoje o estado mora em `estados.json` no servidor, e assim segue: nó e versão
  do fluxo entram no mesmo estado. Se o estado subir para o banco no futuro, entram junto.
- **Relatórios por nó:** contagem diária de quantos clientes passaram, pararam e saíram em cada nó e
  ligação (uma tabela agregada por dia, só com IDs e números, sem dado pessoal). Isso alimenta o mapa de
  calor no quadro.
- **Permissões:** as mesmas da Orquestração (Admin e Planejamento editam; Operação só lê); publicar fluxo
  fica com quem já publica estratégia hoje. A auditoria (`auditoria`) registra cada publicação.

## 4. Como migrar as estratégias atuais

1. **Conversor automático** da esteira para um fluxo equivalente, como o modelo "Cobrança padrão MotorCX"
   do protótipo:
   - Cliente novo vira Entrada → (Esperar → Enviar → Condição "deu CPC?") por dia com ação;
   - "sim" leva a Mudar momento CPC A; o fim da localização leva a Mudar momento Não CPC;
   - Não CPC vira um laço de N dias × M vezes com Esperar;
   - Deu CPC e Acordo continuam como hoje, como blocos "fase do motor" (só leitura no fluxo) na 1ª versão;
   - personas viram Condição "persona = X" antes do Enviar daquele dia.
2. **Prova de equivalência:** para cada estratégia, rodar a esteira e o fluxo convertido em paralelo sobre
   a mesma carteira por 30 dias simulados (o `demo.py` e os `tests/` já fazem dias seguidos). A fila de
   cada dia precisa sair igual. Uma diferença bloqueia a conversão daquela estratégia, que continua esteira.
3. **Nada muda sozinho:** a conversão gera um rascunho. A carteira só passa a Fluxo livre quando alguém
   publica, e pode voltar para a esteira (a definição antiga continua guardada).
4. **Clientes em andamento:** ao trocar a forma, cada cliente entra no nó equivalente ao estado e ao dia em
   que está (LOC D+5 vai para o nó do dia 5). Se não houver equivalente, ele termina a esteira e os novos
   entram no fluxo.

## 5. Convivência: Esteira ou Fluxo livre por carteira

- Em Estratégia > Carteira, o cliente escolhe **Esteira** (padrão) ou **Fluxo livre**. Uma carteira tem uma
  forma só; carteiras diferentes da mesma empresa podem ter formas diferentes.
- A estratégia compartilhada entre carteiras (`segmentos_em_uso`) segue a forma da estratégia: ao mudar a
  forma de uma estratégia compartilhada, o aviso de hoje ("vale em N carteiras") aparece e o "separar"
  continua disponível.
- A Orquestração (raias e Fluxo de leitura, prompts 79 e 80) segue sendo a tela da Esteira. O Fluxo livre é
  outra tela (o quadro do protótipo). A Visão geral mostra os dois no mesmo formato de resumo.
- Relatórios, Lista do dia, Mensageria e Pagamentos não mudam: recebem a mesma fila e os mesmos estados.

## 6. Riscos

| Risco | Efeito | Como reduzir |
|---|---|---|
| Laço sem espera ou sem fim | Disparo repetido no mesmo dia | Validador recusa; limite de nós por dia no motor; recência e intervalo de 12 h continuam valendo |
| Desenho que tenta furar trava | Envio fora de horário ou acima do freio | Travas e faixas aplicadas depois do fluxo, em `gerar_fila` e travas.py; o fluxo não tem campo para desligá-las |
| Cliente preso num nó apagado | Some da fila sem aviso | Versão publicada imutável; cliente termina na versão em que está; alerta "N clientes em nó antigo" |
| Conflito com acordo e quebra | Cobrança indevida de quem fechou acordo | Hierarquia fica no motor; acordo tira do fluxo antes de qualquer passo |
| Divergência esteira × fluxo convertido | Resultado diferente sem ninguém ter mudado | Prova de equivalência obrigatória (seção 4.2) |
| Desempenho da rotina diária | Rotina mais lenta com carteiras grandes | Avaliar só quem tem "próxima avaliação" vencida; Esperar não custa nada |
| Complexidade para o cliente | Fluxos que ninguém entende e resultado pior | Modelos prontos; validação em linguagem simples; simulação antes de publicar; Esteira continua padrão |
| Rastreabilidade | Difícil explicar "por que recebeu isto" | Trilha registra nó e versão; extrato mostra o caminho |
| LGPD | Dado pessoal no quadro ou nos relatórios | Quadro, simulação e relatórios só com contagens; Condição nunca mostra CPF ou nome |
| Suporte e treinamento | Mais chamados | Lançar como piloto com 1 ou 2 carteiras e um guia curto no Suporte |

## 7. Fases sugeridas (estimativa grosseira, 1 dev de motor + 1 de site)

| Fase | Entrega | Estimativa |
|---|---|---|
| 0 · Decisão | Dono e CX validam o protótipo; lista final de blocos e condições | 1 semana |
| 1 · Formato e validador | Bloco de fluxo na definição, versões publicadas, validador no motor, conversor esteira → fluxo, prova de equivalência em teste | 3–4 semanas |
| 2 · Motor em paralelo | Execução do fluxo em "sombra" (calcula a fila e compara, sem enviar) em 1 carteira piloto | 2–3 semanas |
| 3 · Quadro no site | Tela do protótipo no Horizons (por prompts, < 100 linhas cada, 3–4 prompts), só para Admin e Planejamento, com publicar e voltar à esteira | 3–4 semanas |
| 4 · Piloto real | 1–2 carteiras em Fluxo livre, relatório por nó, simulação com taxas reais | 4 semanas de acompanhamento |
| 5 · Abertura | Liberar por carteira para todos; Deu CPC e Acordo editáveis como nós; MotorCli (jornada.json) no mesmo quadro | 4–6 semanas |

Total até a abertura: **cerca de 4 a 5 meses**. O piloto (fases 1 a 4) leva perto de 3 meses.

## 8. Fora deste plano

Editar travas e faixas de segurança pelo fluxo; ações com dado pessoal; canal novo; regra de cobrança nova
sem decisão do comitê (como já vale para `regras/`).
