# MotorCob — Gestão de Contatos para Cobrança

## O problema
Empresas de cobrança disparam de forma pulverizada (discador, agente virtual, SMS, RCS,
WhatsApp, e-mail) e não conseguem taguear o retorno. Sem tag, não sabem qual contato é do
cliente, em qual canal ele engaja nem qual comunicação funciona — e a operação não é
previsível (acionados → contato → CPC → acordo).

## O que o produto faz
Implementa a gestão de contatos do **Playbook de Gestão de Cobrança** (Rennov, ago/2026):
1. **Marcação:** mantém a TAG de cada cliente (`SAFRA-CLUSTER-ESTADO-CANAL-CICLO`) e a
   trilha de eventos, atualizadas automaticamente pelo retorno de cada ação.
2. **Réguas:** gera a fila do dia (localização, CPC/rotação, giro, preventivo, quebra)
   respeitando hierarquia, recência, tentativas e janela.
3. **Contato certo:** a certificação decide EM QUAL telefone/e-mail acionar dentro de cada
   canal e trava o WhatsApp onde há risco de banimento.
4. **Atribuição:** link rastreável por ação liga acesso/login/acordo no portal ao contato e
   ao canal exatos.

## Regras do playbook (fonte da verdade)
As planilhas originais do playbook não existem mais; estas regras as substituem. Os
parâmetros vivem em `regras/regua.json` (validado na carga). **Mudar regra = decisão de
comitê + commit.** Este texto e o JSON têm de dizer a mesma coisa.

**Marcação (TAG)**
- A TAG e a trilha são por `id_cliente`. O CPF (opcional) só agrupa IDs da mesma pessoa.
- SAFRA `S+AAMMDD` = data de entrada na carteira. Imutável.
- CLUSTER = ticket × atraso: A ≥ R$ 5 mil, M R$ 1–5 mil, B < R$ 1 mil; 1 = 0–90 dias,
  2 = 91–180, 3 = > 180. Ticket = saldo atualizado; cliente com vários contratos: soma dos
  saldos e o maior atraso. O cluster de origem é imutável e fica guardado; **a TAG mostra
  o cluster atual**, revisado no fechamento mensal (o playbook diz as duas coisas em
  slides diferentes; esta é a leitura adotada). Exceção (decisão do dono, 07/11/2026): segmento
  da empresa com condição que muda com o tempo (dias de atraso…) é reavaliado todo dia (ver
  "Reavaliação diária" em `motor/cluster.py`).
- ESTADOS: LOC · CPA · CPB · NCP · PRE · QBR · COL · LIQ · **BLQ** (bloqueado: opt-out
  geral, óbito, judicial, reclamação — fora de todas as réguas). Um estado por vez.
- CANAIS: WA · RC · **AV** (agente virtual) · DC · SM · **EM** (e-mail) · ND.
- CICLO: L0–L8 (dia da localização) · T1–T3 · G1… (ciclo de giro; RE = aguardando
  re-enriquecimento) · D-3…D0 (preventivo) · D1…D5 (quebra).
- Toda mudança de TAG gera evento na trilha com "quem marcou" (canal, Planejamento,
  Automático, Sist. acordos).

**O que é contato (vira CPC A)** — por canal, em `regua.json › contato`:
WhatsApp resposta/clique/identidade · RCS interação/clique/identidade · agente virtual
identidade/CPC/promessa/recusa · discador CPC/promessa/recusa · SMS clique/resposta · e-mail clique ·
portal login pelo link. Promessa de pagamento é CPC, não é pagamento (pagamento = quitação ou 1ª parcela).
**Não é contato:** entregue, lido, abertura de e-mail, atendida por terceiro, caixa postal.
Terceiro que diz "não conheço/pessoa errada" nunca vira CPA; o contato é marcado como
de outra pessoa pela certificação e a rotação segue.

**Estados e transições**
- Entrada → LOC-ND-L0 + pedido de enriquecimento (pacote do cluster).
- Contato em qualquer régua massiva → CPA no canal do contato, zera tentativas.
- CPA sem resposta na ação → CPB-T1. CPB: T2, T3 no mesmo canal (48h entre elas).
- Após T3: rotação para o **próximo canal da ordem depois do atual** (circular):
  WhatsApp → RCS → agente virtual → discador → SMS. Canal sem contato elegível é pulado.
- Esgotou todos os canais → NCP + re-enriquecimento.
- LOC sem contato até D+8 → NCP, giro de 8 dias. Após 3 ciclos sem contato → pausa (RE)
  e re-enriquecimento; volta ao giro quando chegam contatos novos.
- Acordo (parcelas do sistema de acordos): COL em dia · PRE D-3…D0 · QBR a partir de D+1
  · D+6 sem pagamento → volta ao estoque como CPA (acordo marcado como quebrado) ·
  todas pagas → LIQ.
- Pagamento só conta com baixa (arquivo D+1). Parcela vencida sem baixa confirmada não
  entra em quebra.

**Réguas (fila do dia)**
- Localização: D+1 WA · D+3 RCS · D+5 agente virtual (discador como reserva no mesmo dia
  para quem o agente não contatou) · D+7 SMS.
- Giro (NCP): mesmos passos em ciclo de 8 dias (dia 1, 3, 5, 7), reinicia no dia 9.
- CPC: CPA negocia no canal localizador; CPB segue T1–T3 e rotação.
- Preventivo/colchão: D-3 RCS (SMS se sem RCS) · D-1 WA · D0 WA + discador se ticket A.
- Quebra: D+1 WA · D+3 discador · D+5 discador + SMS.
- E-mail sempre acompanha o SMS como reforço com link. RCS sem contato elegível → SMS.
- Hierarquia: QBR > PRE > COL > CPA > CPB > LOC > NCP. COL suspende ações massivas.

**Regras de contato**
- Recência de 48h entre ações massivas para o mesmo cliente; réguas de data fixa
  (preventivo e quebra) são isentas.
- 1 ação massiva por cliente por dia; 3 tentativas por canal (tentativa = um dia de ação
  no canal); discador até 3 spins/dia, que contam como 1 tentativa.
- Janela: seg–sex 8h–20h, sábado 8h–14h, sem ações em domingo e feriado (lista no JSON).
  Validar com o jurídico.
- Números por canal: voz aciona todos os números válidos em ordem de score; digital, até 2
  na localização/giro e 1 (o localizador) em CPC/acordo.
- **WhatsApp:** livre para contato CERTIFICADO, score ≥ 0,8 ou o próprio contato
  localizador. Para os demais, só **1 número por cliente**, com "WhatsApp válido" no
  enriquecimento. **Freio automático:** se bloqueio + pessoa errada passar de 2% dos envios
  dos últimos 7 dias (mínimo 50 envios), WhatsApp fica só para contatos confiáveis.
- Cluster B3: só canais digitais.

**Enriquecimento**
- Obrigatório em D0 para 100% dos entrantes; pacote por cluster (A1 completo … B3 só
  digital). Revalidação a cada 30 (A), 60 (M1/M2) ou 90 dias (M3/B), pela data
  `atualizado_em` dos contatos. Também pedido quando esgota canais ou giro.
- Campos esperados do fornecedor: contato, flag WhatsApp ativo, data de atualização, score.

**Orçamento e operação**
- Recuperação prevista = acordos previstos × ticket médio × % de parcelas pagas. Receita
  prevista = recuperação × % de remuneração (comissão/honorários; premissa por credor).
  ROI = receita ÷ orçado: ≥ 1,5x aprova · 1,0–1,5x aprova com plano · < 1,0x reprova.
  Premissas em `regua.json › orcamento`. O custo é o variável das tentativas (fornecedores);
  custos fixos não entram, por isso o ROI por ação tende a ser alto.
- Real x Previsto: cada tentativa é atribuída à régua em que o cliente estava no começo do
  dia (pela trilha); cada acordo, à régua e ao canal do contato que o originou. Acordo que
  já existia quando o cliente entrou no motor não conta como nascido de ação.
- A ordem de rotação sugerida pelo relatório (menor custo por contato) é só sugestão ao
  comitê; a ordem vigente só muda no `regua.json`.
- MVP roda 1x/dia de manhã (`rodar_dia.py`). Marcação em até 1h fica para a integração em
  tempo real.

## Princípios de arquitetura (não violar)
- **O núcleo é determinístico e estatístico.** TAG, réguas, score, certificação e fila por
  registro NUNCA passam por LLM. Motivos: escala, custo e auditoria.
- **Agentes atuam na borda:** mapear layouts novos, analisar resultados, propor mudanças de
  régua ao comitê, validar compliance. Eles leem as saídas do motor.
- **Engajamento ≠ titularidade.** Contato (CPA) é regra operacional do playbook;
  certificação é outra coisa: só CPC, identidade confirmada ou login no portal certificam,
  e é a certificação que libera o WhatsApp.
- **`sem_conta` no WhatsApp restringe o canal, não invalida o telefone** (expira em 90 dias).
- **O motor roda pelo `id_cliente`**, nunca pelo CPF. O CPF vira chave pseudônima em
  memória e não vai para nenhuma saída. **O CPF nunca é o id (decisão do dono, 07/11/2026; SQL 73):** carga sem
  código de cliente (a coluna do cliente é a do CPF) ou código com cara de CPF (11 dígitos com DV válido ou
  000.000.000-00) → código pseudônimo `MX` + 16 letras = HMAC-SHA256(`faturamento_sal` da empresa,
  "motorcx:id_cliente:v1:" + documento) (`motor/pseudonimo.py`; o banco tem a mesma conta em `id_cliente_pseudonimo`).
  Estável (mesmo cliente = mesmo código; o sal nunca muda); código de cliente de verdade não muda. O valor original
  fica só local (`base/ids_originais.csv`, como `pessoas.csv`) para acordo/baixa/ocorrência acharem o cliente; as
  listas `ids/` ganham a coluna `contrato` no fim quando o id é o código (o cliente cruza pelo contrato; CPF nunca
  vai na lista). Estado antigo com CPF: `migrar_pasta` troca uma vez (marcador `estado/ids_sem_cpf.txt`), a nuvem
  manda os pares a `rechavear_clientes` e republica os dias de saída (`nuvem/ids_cliente.py`). Trava: o check
  `<tabela>_id_cliente_sem_cpf` no banco e `checar_linhas`/`checar_csv` antes do PostgREST e do Storage.
- **Contato certificado para uma pessoa é evidência contra as outras** e a favor dos outros
  IDs da mesma pessoa.
- **Retorno reimportado não conta duas vezes.** Resultado desconhecido nunca é classificado
  por palpite (vai para quarentena).
- **Estado é salvo com troca atômica** e a rotina diária é idempotente (rodar duas vezes no
  mesmo dia não reprocessa nada).

## Estrutura
- `regras/regua.json` + `motor/regua.py`: regras do playbook, validadas contra a taxonomia.
- `motor/marcacao.py`: TAG, estados, transições e trilha (`processar_dia`).
- `motor/fila.py`: fila do dia, contatos elegíveis por canal, freio do WhatsApp, lista de
  enriquecimento.
- `motor/acordos.py`: situação do acordo a partir das parcelas e da data de baixa.
- `motor/kpis.py`: KPIs das 5 frentes por safra/cluster, migração de estados, realizado por
  ação (régua × canal), benchmarks e sugestão de ordem de rotação.
- `motor/recuperacao.py` (SQL 77): resultado de cada ação até o dinheiro, só agregado (dia da ação × canal × fase/etapa
  × segmento × persona × volta × dia do ciclo: ações, contato, CPC, promessa, opt-out, custo, acordo, valor do acordo,
  pagamento, valor pago) e contato por posição do número × dias seguidos no mesmo número.
- `relatorio.py` + `relatorios/excel_comite.py`: relatório do comitê (CSVs + Excel com
  fórmulas: Resumo, Premissas, Real x Previsto, KPIs, Migração, Benchmarks). O Excel exige
  `openpyxl` (única dependência, fora do núcleo).
- `motor/certificacao.py`: score Beta por contato, status, hit rate, afinidade.
- `motor/taxonomia.py`: retorno bruto de cada canal → `Nivel` + pesos + restrições.
- `motor/voz.py`: tabela ÚNICA dos desfechos de voz (discador/agente virtual). Dela saem a taxonomia da voz,
  `discagem.MARCA_VOZ`, `NAO_COMPLETADA`/abandono (curtas), `NAO_ATENDE` (descanso), os genéricos de voz da
  ocorrência (`entrada.GENERICOS`) e as marcas do site (`GENERICOS_SITE` = CHECK do banco). Também os flags
  `e_cpc` (= `regua.json › contato`), `conta_tentativa` (hoje todos) e `prova_existencia`, e as listas SIP/Q.850 que
  confirmam (tipo A/B) ou nunca confirmam inexistente (`tipo_confirmacao`; só dados até a ingestão ler causas).
  Desfecho novo = uma linha lá. Paridade com os valores antigos em `tests/test_voz.py`.
  **De-para da rede (decisões do dono, 31/10/2026; `regras/voz_causas.json`, gerado do de-para SIP/Q.850 do
  especialista e validado na carga por `voz.carregar_causas`):** quem disca é sempre o agente de IA; humano só por
  transferência SIP para o discador do cliente. Cada tentativa guarda SEPARADOS no `Evento` a rede (`causa_sip`,
  `causa_q850`; DIALSTATUS/AMD/toque só decidem), o evento da IA (`resultado_ia` = coluna resultado) e a tabulação
  do operador (`resultado_operador`, depois da transferência), mais `transferencia` (atendida|sem_operador|falhou),
  `destino` (ia|ia_humano), `origem_resultado`, `identidade_confirmada`, `rota`, `id_chamada`. `voz.classificar_chamada`
  decide o desfecho: operador > transferência sem operador/falhou (= `transferencia_sem_operador` desde o SQL 106;
  antes `abandonada`) > IA > rede; "não atende"
  genérico cede para a rede; inexistente só com causa confirmável (tipo B só com `numero_canonico`; senão
  `falha_operadora` + aviso NORMALIZAÇÃO). Chaves novas (só com código/coluna novos): as 8 situações do dono
  (`voz.SITUACOES_DONO`: maquina, nao_atendida, ocupado, caixa_postal, desligou_sem_conversar, retorno_agendado
  (CPC), atendeu_desligou, numero_inexistente/atendida_terceiro_desconhece) + falha_operadora, bloqueio_originacao,
  cancelada_discador (técnicas: fora da certificação, mas CONTAM como tentativa e como curta), indisponivel,
  rejeitada, mudo, fax. Layouts (fornecedor e ocorrência) aceitam as colunas novas e os nomes `numero_discado`,
  `billsec`, `id_chamada` (um registro por canal por tentativa: id da ocorrência = `<canal>:<id_chamada>`); voz sem
  esses dados → aviso de dados mínimos. CPC da IA (`discagem.agente_ia`, `DG.peso_cpc_ia`): 1,0 com identidade
  confirmada na chamada, 0,5 sem (`Evento.peso_pro`, só a certificação; a régua não muda; operador = 1,0);
  `inexistente.aceita_tipo_b=false` faz o tipo B virar falha da operadora. Resumo em r["discagem"]["agente_ia"].
  Site: sem mudança (o mapeamento do site segue com as 4 marcas; as colunas novas valem nos layouts do repositório).
  O peso 0,5 vale só para chamada nova (com `origem_resultado` ou o campo de identidade): layouts atuais do
  `agente_voz` ficam como estão.
  **Eventos pós-atendimento (IA e operador) movem o processo:** `voz.unificar_chamadas` (rodar_dia, antes de tudo)
  deixa um registro por (canal, `id_chamada`): a tabulação mais forte (`voz.FORCA`; operador antes da IA), com os
  campos que só os outros traziam (data/valor da promessa, retorno, causas) e a identidade confirmada de qualquer
  um deles. Colunas novas `valor_promessa` e `retorno_em` (Evento). Saídas de etapa (`etapas.EVENTOS["cob"]`):
  `promessa` e `retorno_agendado`, além de cpc, acordo, pagamento e fim_janela; vêm de
  `ET.eventos_pos_atendimento` (desfechos de voz desde a última rodada, `etapas.json › eventos_ate`; uma vez só).
  Acordo proposto pela IA/operador entra como promessa (acordo de verdade só pelas parcelas). Renitência: a promessa
  suspende a voz até a data + 1 (`promessa_suspende`, como antes). Próxima ação: `discagem.retorno_agendado`
  (`DG.retornos_agendados`): antes do dia a voz espera (sem_voz "retorno agendado…"); no dia a linha de voz leva
  `agendar_para` e sai no topo do `discador_mailing.csv` (coluna nova no FIM); sem hora → `sem_hora_dias`; fora
  de `de`–`ate` ou domingo → próxima abertura + alerta; > `max_dias` → limita + alerta.
- `motor/ingestao.py` + `layouts/*.json`: retornos por layout de fornecedor, base de
  clientes (agrega contratos), carteira de contatos e parcelas.
- `motor/cluster.py`: cluster por regras da empresa (tabela `clusters`, editada no site).
  Condições sobre colunas da base bruta (`base/atributos.csv`, contrato de maior saldo;
  sem contato/CPF) e campos calculados (saldo, dias_atraso, qtd_contratos); vale a
  primeira regra que bate, senão o padrão ticket × atraso de `regua.json`. Cada cluster
  define pacote, revalidação, só digital, voz no D0 e canais bloqueados
  (`Regua.com_clusters`). Mudou a regra → `cluster_versao` muda → todos revisam o cluster
  atual na rotina seguinte; rodada repetida no mesmo dia ("Reenquadrar agora") revisa já
  (`marcacao.revisar_clusters_alterados`). Regra inválida vira alerta, nunca derruba a rotina.
  **Reavaliação diária (SQL 76, decisão do dono 07/11/2026):** segmento cuja condição usa um campo que muda sozinho
  com o tempo (`cluster.CAMPOS_DIARIOS` = dias_atraso, idade; e "persona" quando alguma persona da carteira usa um
  deles; `cluster.segmentos_diarios` → `Regua.segmentos_diarios`) é reavaliado TODA rotina (`marcacao.reavaliar_diario`:
  nos dias pendentes do `processar_dia` e em `reavaliar_segmentos_diarios(hoje)` antes da lista, então quem passa de
  30 dias hoje já sai hoje na régua do segmento novo; trilha "reavaliação diária do segmento", quem marcou
  "Automático"; idempotente). Ordem sempre a da empresa: no segmento diário, vale a 1ª regra que bate hoje (ou o
  cluster padrão); num segmento mensal (ou em Demais), o cliente só sai para um segmento diário ACIMA dele que passou a
  bater (mensal que deixou de bater por saldo/coluna espera o mês). Os outros segmentos e o cluster padrão seguem
  mensais; `cluster_revisado`/`cluster_versao` não mudam. **Mudou de segmento (diário, mensal ou regra alterada):** só a
  régua troca, no mesmo dia: momento (LOC/CPA/CPB/NCP/PRE/QBR), ciclo, canal, tentativas, Hot, candidatos, giro
  (`giro_inicio`; o nº do ciclo é recalculado com o `ciclo_dias`/`max_ciclos` da nova, e passar do máximo pausa o giro
  para re-enriquecimento), `inicio_esteira` (o Dia N continua; localização mais curta na nova leva ao Não CPC na
  rotina seguinte) e acordo são do cliente e continuam; as etapas próprias da estratégia antiga são zeradas
  (`etapas.json` guarda `estrategia`; a nova começa do dia 0 dela; estado sem a marca só ganha a marca). Pacote de
  enriquecimento não é pedido de novo. Cobrança e contadores: a Orquestração é cobrada por CPF distinto no ciclo
  (SQL 69), não por segmento, então trocar de segmento não muda a fatura; ações e KPIs ficam com o segmento do dia
  da ação (escolhas.csv/acoes_dia), o Real x Previsto com a régua do começo do dia, e o resumo/enquadramento com o de hoje.
  **Prévia (SQL 76):** a rotina grava `atributos_previa` (`motor/previa.py` → `nuvem.publicar_previa`; carteira
  inteira com a data de hoje e depois apaga as outras datas): por cliente em cobrança (na carga, fora BLQ/LIQ),
  id pseudônimo, segmento de hoje (null = Demais), saldo, dias de atraso NO DIA, contratos e só os atributos que valem
  em condição sem identificar ninguém (`previa.CALCULADOS` + colunas da carga que passam em `colunas_publicaveis`: nome
  de dado pessoal nunca; texto com até 50 categorias; número sem cara de código). O site não lê a tabela (RLS sem
  política); `previa_segmentacao(empresa, credor, proposta)` (security definer: `pode('editar_orquestracao')` ou equipe
  que vê a empresa; nada para anon) avalia `{"segmentos": [{codigo, nome, ref, condicoes}]}` NA ORDEM com a mesma regra
  de `condicao_ok` (`previa_condicao_sql`, `previa_numero` = `cluster.numero`) e devolve só contagens: por segmento (1º
  que bate e quantos batem), Demais, sobreposições, "de onde vêm" (hoje → proposto), campos sem dado e a data-base.
  Paridade com `cluster.classificar` em `supabase/testes/testar_segmentos_previa.py`. Diferenças conhecidas:
  `casefold` × `lower` ICU ("ß"), número com expoente de 3+ dígitos/`inf`/`1_000` (motor lê, prévia não). Banco sem o
  SQL 76: a rotina segue e alerta.
  Números das condições (segmento, persona do usuário, estágio) em pt-BR: o site (`site/src/lib/condicoes.ts`,
  campos em `components/comuns/campos-condicao.tsx`) lê "1.500,50", "1500,5", "1500.50" e "1.500" (= 1500) e
  grava NÚMERO (JSON) nas condições numéricas; texto salvo antes segue com o sentido que o motor dava
  (`cluster.numero`: com vírgula = pt-BR; sem vírgula, um ponto = decimal; 2+ pontos em grupos de 3 = milhar).
  `entre` = faixa fechada [de, até] (site "está entre (faixa)"); `em`/`nao_em` = "é um destes", itens
  separados por ";". `persona._faixa` lê as faixas do motor (ponto decimal, 1e+06) e em pt-BR.
- **Fluxo da operação (o que importa no dia a dia):** carga do credor do dia
  (`base/na_carga.csv` = universo de ações; quem saiu não é acionado nem bloqueado) →
  lista do dia com **1 contato por cliente por canal** (inclusive voz: `numeros_voz` em
  `regua.json`) → ocorrência só com CPC sim/não → o contato da ação vira **Hot**
  (`contato_localizador` + certificação) e o canal do CPC fica marcado (`canal_atual`).
  Status do contato na exportação (`status_contato` em `fila_do_dia.csv`): HOT · WHATSAPP
  · RCS · NEUTRO · INVALIDO; marcas `hot`/`whatsapp`/`rcs` podem vir por telefone na carga.
  Rotação sem Hot: `EstadoCliente.contatos_tentados` recebe o que foi exportado em cada dia
  (`escolhas.csv`, sem reservas, via `processar_dia(enviados=...)`); `candidatos()` ordena
  não tentados primeiro e depois os tentados do mais antigo (1, 2, 3, 4, 1…). Com Hot
  (`contato_localizador`), a lista é zerada e o Hot vai primeiro sempre. `numeros_digitais`
  e `numeros_voz` = 1 por padrão.
  Mais de um contato por canal: `canais_empresa.numeros_por_cliente` (1 padrão, 99 =
  todos). CPC sem contato identificado → `EstadoCliente.candidatos_hot` (contatos da ação,
  via `Evento.candidatos`); em CPA/CPB sem Hot, um candidato por vez até um dar CPC
  sozinho; candidato acionado sozinho sem CPC sai da lista.
  Nome do arquivo não importa: cada pasta (bruto/, ocorrencias/, enriquecimento/) só
  recebe um tipo; colunas opcionais ausentes no arquivo do dia ficam vazias.
- `motor/persona.py`: personas aprendidas a cada rotina (`aprender`): tentativas por
  cliente × canal × dia (sucesso = `regua.e_contato`), características (atributos da carga
  + faixa_saldo, faixa_atraso, ddd, tem_whatsapp, tem_rcs; numéricas em tercis), seleção
  automática das 2 que mais separam (qui²/gl ≥ 4, grupos ≥ 30), taxa encolhida
  persona → 1ª característica → carteira (Beta, força 50). Ranking por CPC por real
  (taxa ÷ custo; canal sem histórico vai depois). Etiquetas `persona_1`/`persona_2` na
  estratégia são trocadas pelo canal do cliente (`resolver_tokens`, 10% exploração
  estável por cliente/dia). `sugerir`: régua cujo 1º canal rende < 1/1,2 do melhor com
  ≥ 200 tentativas → sugestão; aprovada no site, `nuvem.aplicar_sugestoes` cria segmento
  (condições da persona, no topo) + estratégia com a troca. Tabelas `personas` e `sugestoes`.
- `motor/carteira.py` (credores): pasta do credor com bruto/ (carga geral: substitui o
  estoque), incremental/ (soma), retirada/ (tira contrato, com motivo), acordo/ (parcelas) e
  baixa/ (pagamentos). `converter_base` monta o estoque por contrato em ordem de data
  (geral → incremental → retirada → pagamento no mesmo dia); `montar` liga contrato→cliente,
  aplica baixas nas parcelas (informada ou mais antiga em aberto, ≥ 99% = paga), manda o resto
  como quitação/parcial ao estoque, grava base/parcelas.csv (quitação sem acordo = acordo
  "QUITACAO" pago → LIQ) e na_carga = estoque + acordo aberto (salvo retirado depois).
  base/pagamentos.csv: toda baixa por cliente (parcela de acordo, quitação ou parcial), reescrito
  inteiro a cada montagem (não duplica). `pagou` = 1 só para quitação (tipo informado ou valor
  ≥ 99% do saldo) ou 1ª parcela do acordo paga: acordo sem parcela paga é promessa, não
  pagamento (decisão do dono, 26/10/2026). É o alvo da Propensão a pagamento.
  Layouts `retirada`, `acordo`, `baixa` (e `incremental` opcional) em empresas/<slug>.json.
- Nota de contato (Abordagem da persona › Contato; `certificacao.nota_contatos` → `NotaContatos`): por
  (cliente, contato, canal) = É dele (`Certificacao.score`) × Chega (Beta do retorno de canal: entregue/lido/
  clique ÷ envios com retorno por contato × canal × dia, meia-vida 60, prior = taxa do canal na carteira; voz
  = discador e agente) × Responde (CPC do contato no canal ÷ tentativas/dia, encolhido para
  `Afinidade.prob_cpc` do cliente, `FORCA_RESPONDE` 5). Calculada sob demanda; `rodar_dia` certifica hoje UMA
  vez antes dos dias pendentes, calcula a nota e grava `estado/contatos_nota.csv` (só contatos com
  histórico; troca atômica; **contato nunca vai ao banco**). Na fila (`candidatos(notas=)`) só troca o
  desempate `-score` por `-nota` do canal (Hot → rotação → `prioridade_contatos` → nota → score → ranking);
  localizador primeiro e a trava do WhatsApp ficam como estavam (a nota ordena dentro do que ela libera);
  voz disca nessa ordem. Cliente sem histórico próprio: ordem idêntica à antiga (teste de paridade). Erro na
  nota (no cálculo ou no meio da fila) → ordem antiga + alerta "NOTA DE CONTATO". Resumos por cliente viram
  atributos calculados (segmentos e personas da empresa; fora da persona aprendida, `persona.FORA_DA_PERSONA`,
  porque vêm do mesmo histórico de CPC e dominariam a seleção): `melhor_contato` (alta/média/baixa pelos tercis da maior
  nota; sem), `tem_contato_certificado`, `contatos_alcancaveis` (0/1/2+, Chega ≥ 0,5). Bloco
  `personas.contato` (SQL 49): acionados, localizados (Hot ou certificado), taxa de localização, ações até
  o 1º CPC (`acoes.agregar(primeiro_cpc=)`) e evidência pelos cortes da maturidade (30/200). Banco sem o
  SQL 49: publica sem e alerta.
- `motor/discagem.py` (Discador, fase 1; vale para qualquer discador: o MotorCX decide quem, qual número,
  quantas vezes e em que janela; informa, sugere e alerta, e quem decide é o cliente). Bloco `discagem` em
  `regua.json` (validado) < do credor (`rodar_dia(discagem=)`, tolerante) < trava `ligacoes` da estratégia
  (por_dia/por_numero/intervalo_min/intervalo_ocupado). Taxonomia de voz: promessa e recusa (CPC), recado,
  ocupado, abandonada, falha_rede (fora da certificação), opt_out (`voz:opt_out` → todos os canais de voz).
  Evento ganha `hora`, `duracao_s`, `data_promessa` (colunas opcionais `hora`/`duracao`/`data_promessa` nos
  layouts). Horário por UF/DDD vem LIGADO por padrão com a prévia (decisão do dono, 08/11/2026; "confirme com o seu
  jurídico"; desligar é escolha gravada `{"ativo": false}` e o site mostra a faixa vermelha do fuso de Brasília)
  (`discagem.horarios.ativo`); ligado: (`Regua.janela_do_numero` = estratégia ∩ canal ∩ UF do DDD
  em hora local → Brasília ∩ 08:00–20:00, sem domingo/feriado; tabela do cliente, senão a PRÉVIA
  `regras/horarios_uf.json`, que não é orientação jurídica; número sem janela não sai na voz, o próximo
  assume, motivo na Lista do dia). Ligados por padrão: bloqueio de inexistente (layout com `inexistente_confirmado` só aceita
  esses códigos; o resto vira falha_rede), "não ligar", o aviso de chamadas curtas (70%) e o corte (80%). Desligados, com
  o valor recomendado: descanso por N "não atende" (pausa da voz no número via `retorno_canal`,
  `temporarios_janela_dias`), recusa (descanso da voz do cliente) e promessa (voz suspensa até a data + 1).
  Chamadas curtas (Despacho Anatel 100/2026 e MP 1.396/2026, vigência 12/11/2026; decisão do dono 08/11/2026: corte
  ligado em 80%, aviso 70%; a carteira que gravou `corte_ativo: false` mantém, a que não gravou a chave fica com o
  padrão; o site grava só os campos que mudou): conta como curta a não completada, a caixa postal e a de até 6 s
  (falha técnica sempre: `falha_conta` travado em sim, motor e `chamada_curta_voz` do SQL 80); uma linha com mais
  de 1.000 no dia, ou o total da empresa com mais de 10.000, e 85% ou mais de curtas → a operadora bloqueia todas as
  linhas da empresa por 15 dias (texto em `DG.REGRA_CURTAS` = site `REGRA_CURTAS`; abandono
  configurável): KPI medido pelos retornos de voz, previsão = Σ tentativas × P(curta) do número (Beta,
  prior da carteira), alerta "CHAMADAS CURTAS" (≥ aviso e volume ≥ uma linha) com sugestões; corte (se
  ligado) pelo fim da prioridade, preventivo/quebra ficam (motivo `corte_curtas`). O motor não sabe a
  linha de origem: o limite por linha vira "linhas mínimas". Saída nova `saida/<dia>/discador_mailing.csv`
  (`DG.CAMPOS_MAILING`; nunca CPF/nome); `ids/discador.csv` não muda. Erro nas regras nunca segura a
  lista (sai como antes + alerta "DISCAGEM"). Resumo em r["discagem"].
  **Número inexistente (decisão do dono, 31/10/2026; `discagem.inexistente`, `DG.protecao_inexistente`, antes de
  `ajustar_eventos`):** modo `so_voz` (padrão; `invalida` = regra antiga): o inexistente da voz vira `inexistente_voz`
  (não invalida o número na certificação; Afinidade ignora) e vale só para a voz, por (cliente, número): 1ª
  confirmação = quarentena (`discador/agente_voz:suspenso`) por `reteste_dias` (7); 2ª em OUTRO dia (`confirmacoes`,
  2) = voz encerrada no número para este cliente (`<voz>:inexistente`); prova de existência (`voz.PROVA_EXISTENCIA`:
  caixa postal, ocupado, atendida…) zera; reteste sem conclusão renova a quarentena até `max_retestes` (3), depois
  fica suspensa sem encerrar + alerta. Sinal para mensagens (`sinal_outros_canais`): cada dia de confirmação vale meia
  falha de envio no Chega do número em SMS/RCS/WhatsApp (`nota_contatos(sinais_voz=)`; nunca restringe). Trava de
  lote (os dois modos): arquivo × dia (e rota) com ≥ `trava_lote_minimo` (200; rota 50) chamadas e > 30% de
  inexistente, ou > 2× a mediana de 14 dias do fornecedor e +10 p.p. → as confirmações viram falha de rede, alerta
  "DISCAGEM: suspeita de falha da operadora" e aviso no sino da empresa (`sincronizar.aviso_lote_discagem`). Só
  retornos a partir de `so_voz_desde` (2026-11-01): os anteriores seguem a regra antiga (número já inválido fica
  inválido; `resumo.inexistente.anteriores_regra_antiga`); para reavaliá-los o credor põe uma data anterior. Vale
  mesmo se as regras do credor falharem (padrão do regua.json); erro → regra antiga só na rodada + alerta. Não muda a
  contagem de tentativas. Dia em aberto reprocessado usa o ciclo daquele dia (`DG.ciclo_inexistente`), não o de
  hoje. `retorno_canal`: "bloquear"/"retestar" da voz também tiram só a voz.
- **Renitência, regra por sinalização, modo de discagem e reciclagem (SQL 65; protótipo funcional aprovado em
  01/11/2026):** tudo em `credores.discagem` (uma validação, um histórico, uma auditoria). `por_situacao`
  {situação: {max_dia, conta_descanso}}, `falhas_tecnicas` {falha: {aviso}}, `chamadas_curtas.falha_conta`,
  `por_sinalizacao` {sinalização: {finaliza, rediscar: {ativo, depois_min, max, prioridade topo|normal|fim}, depois:
  {acao proximo_telefone|proximo_cliente|finaliza, espera_min}, ate}} (`DG.SINALIZACAO_PADRAO`; vertical troca o depois
  de máquina/não atendeu/caixa postal), `modo_discagem` {modo vertical|horizontal, max_telefones_dia, ordem, spins
  {quantidade, intervalo_min, regras [{spin, telefone, inicio}]}, telefone_ausente} (padrão spin N → telefone N) e
  `reciclagem_auto`. **Um intervalo só por situação: `rediscar.depois_min`** (decisão do dono). **Sem as chaves, tudo
  como antes (paridade, `tests/test_resubmit.py`), inclusive 2 tentativas por número; com a regra nova, 3.** Fixos:
  CPC/promessa/recusa/"não ligar" finalizam; pediu retorno finaliza; inexistente e pessoa errada não rediscam; sem
  crédito e bloqueio pausam a rota e alertam. `indisponivel` virou falha técnica (fora da certificação e do descanso,
  ainda conta como tentativa). Motor: `DG.telefones_dia` define quantos telefones de voz saem por cliente
  (`fila._limite_padrao`). VM (`voz/orquestrador/lote.py`, `RegrasLote` via RPC `regras_discagem_voz`): monta os spins
  (o spin N só abre quando o N−1 passou pelo lote, depois do intervalo e do início) ou corta os telefones (vertical);
  depois de cada tentativa aplica a linha da sinalização; ordem = voltas topo > 1ªs tentativas > voltas normal > fim
  (topo fura as 1ªs: a regra 5 do agendador mudou). Cada decisão vai para `voz_resubmits` (só destino_hash); chamadas
  levam `passada` (tentativa do cliente no dia), `situacao_origem`, `resubmit_id`, `lote_id` e `destino_hash`.
  "Reenviar agora" (`reenviar_lote_voz`) e "Reciclar mailing" (`reciclar_lote_voz`, `voz_reciclagens`; não ligar e
  inexistente nunca voltam; "mantém o limite" por padrão; automática uma por lote no dia) passam pelas mesmas regras.
  À noite a VM agrega `voz_passadas_dia`; o site lê `contato_por_passada` (menos de 30 chamadas = sem %). O site grava
  só por `salvar_discagem` (`discagem_erros` = o motor; versões em `regras_voz_versoes`); a edição da regra por
  sinalização, do modo e da reciclagem segue o redesign aprovado (renitencia-v2): Discagem › Renitência (cartões
  Limites, Modo e Spin com gavetas; regra por sinalização com uma frase por linha que abre no lugar e "Mostrar só o
  que muda"), Resubmit (prévia de ontem e reciclagem automática), Contato por passada; no lote, "Reenviar agora" é a
  ação principal e "Reciclar mailing" é um modal em 3 passos com a prévia completa. Peças em
  `site/src/components/discagem/renitencia/` (unificar com os componentes de design compartilhados quando chegarem).
  **Pausa da rota:** sem crédito (falha da operadora + SIP 402) ou bloqueio de originação pausam o tronco na hora no
  núcleo da VM (`Agendador.pausados`; com ou sem a regra nova; o número não é penalizado e espera outra rota ou a
  retomada), o Plantão grava em `voz_troncos_pausas` (`pausar_tronco_voz`, aviso para a equipe; bloqueio = crítico) e
  lê as ativas a cada 30 s (`troncos_pausados_voz`). Retomar é da equipe com `gerenciar_troncos_voz`
  (`retomar_tronco_voz`, com nota e auditoria). Prévia da reciclagem: chamadas com as rediscagens, ondas, duração,
  `cabe_pct` por janela UF/DDD (`voz_lotes.janelas`, a VM conta) e curtas previstas (`chamada_curta_voz` = `e_curta`).
  `DG.previsao` com a regra nova soma spins e rediscagens (`DG.plano_voz`). A agregação da noite grava
  `execucoes.resumo.voz.resubmit` (`resumo_resubmit_voz`: por situação e motivo de ficar fora, só contagens).
- `motor/retroalimentacao.py` (Speech Analytics, SQL 60): regras sobre os agregados de voz (horário → trava de
  horário, renitência depois de ocupado, frases, ordem de ofertas, canal preferido, propensão em sombra) com piso
  n >= 200 por grupo e diferença >= 5 p.p.; registra por `registrar_recomendacao_voz` (o banco cuida dos 90 dias da
  dispensada). "Aplicar" (site, `aplicar_recomendacao`) só cria rascunho: estratégia NOVA sem vínculo ou frase
  desligada; nunca publica. Impacto: 28 dias antes × depois quando o rascunho entra em uso. Relatório ao credor
  (`montar_relatorio`): só agregados >= 30; estimativa = metade da diferença, faixa 25–75%. VM (`voz/analise/`):
  trechos mascarados (`redigir_trecho`) com embedding Vertex São Paulo 1536, busca semântica pendente → VM responde,
  fila da curadoria, PDF do relatório e uso de IA (`registrar_uso_ia_voz`: custo real para a margem, separado da
  quantidade cobrada no item `ia_speech_analytics`; custo nunca é repassado).
- `voz/analise/analisador.py` + `rotina.py` (Speech Analytics, SQL 62): na VM, cada transcrição mascarada
  (`/var/motorcx/transcricoes`) vira UMA chamada ao LLM da Montagem (esquema fechado; resposta fora das listas é
  recusada e pedida de novo, até 3 chamadas): nota na versão do checklist vigente no dia, códigos fechados
  (`catalogo.py`: motivo, objeções, intenção de `voz_intencoes`, canal/horário, riscos, frases, temas promovidos),
  vulnerabilidade só como sinal em `voz_alertas`, dúvida para a Curadoria. `gravar_analise_voz` grava tudo numa
  transação, com o uso de IA (tokens reais; minuto cobrado só na 1ª análise ok). Noite (02:40): `agregar_speech_dia`
  refaz os `_dia` (idempotente; operador só com ID do discador), depois as regras e o impacto de 28 dias de
  `motor/retroalimentacao.py` pelas RPCs. Desligado por padrão: metadado `motorcx-speech-analytics=1` na VM e
  `voz_config.speech_analytics` por empresa (desde o SQL 87, igual ao módulo `speech_analytics` da Contratação, por
  gatilho nos dois sentidos; a área Speech Analytics do site também depende do módulo). Os dois acessos da VM (funções de `voz_vm`).
- `voz/importador/` (SQL 64): importador das gravações do discador do cliente, na VM (timer
  `motorcx-voz-importador`, metadado `motorcx-importador-gravacoes=1` e, por fonte, `leitura_automatica`; os dois acessos).
  Fontes por empresa em `voz_import_config` (envio pelo site no bucket `gravacoes-discador`, SFTP com a chave do servidor
  fixada, HTTPS só nos domínios autorizados); credencial só no Secret Manager pela referência (equipe com
  `gerenciar_troncos_voz`); o Admin cadastra (`importar_gravacoes`). Manifesto estrito (`manifesto.py`: coluna de dado
  pessoal recusa o arquivo, linha com CPF/telefone/e-mail vai para a quarentena; `id_chamada` vira hash só de letras =
  `voz_gravacoes.chave_importacao`, reimportar não duplica). Par com a transferência da IA (`preparar_importacao_voz`:
  `id_chamada_motorcx` ou janela `janela_par_s`; ambíguo/sem par nunca casa). Áudio no bucket da empresa
  (`discador/<AAAA>/<MM>/<DD>/<chave>.<ext>`), `voz_gravacoes` origem discador + `operador_ref`, fila do Whisper
  (`<gravacao>.<ext>`); o worker (`--registrar`) sobe a transcrição redigida ao lado do áudio no bucket
  (`<caminho>.transcricao.json`, lida no site pela Edge Function `gravacoes`, quem = `ligacao`), devolve a situação e o
  caminho e cobra os minutos em `voz_transcricao` uma vez só.
  Registro por execução e arquivo (`voz_import_arquivos`) e quarentena com motivos novos, na tela Gravações do discador.
- `voz/transcricao/ia.py` + `voz/analise/temas.py` (Speech Analytics da IA, SQL 63): os três provedores (Montagem
  por `ConversaComTurnos`, ElevenLabs pelo transcript do webhook/API de conversas, Simulador pelos turnos do cenário)
  entregam a conversa no evento `transcricao`; o orquestrador grava só de ligação GRAVADA, mascarada (`redacao.mascarar`)
  em `/var/motorcx/transcricoes/empresa_<id>/ia_<id_chamada>.json` (90 dias; o Whisper nunca transcreve `ia_…`). A
  gravação da IA (`credor_<id>/<data>/ia_<id_chamada>.wav`, id sem 10 dígitos seguidos) entra em `voz_gravacoes` depois
  do upload (`registrar_gravacoes_ia_voz`); o nome sem extensão é o `<ref>` que casa as duas. Depois de cada análise,
  janelas mascaradas em `voz_trechos` (embedding Vertex com pgvector; componente `embeddings`). Segunda 03:20: temas
  novos pela clusterização dos trechos do cliente sem tema/intenção (vetor ou TF-IDF); grupo ≥ 30 conversas vira tema
  `novo` + item `tema` na Curadoria com nome SUGERIDO (componente `temas`); nome e promoção são de pessoa. `oferta`
  (primeira oferta do fluxo: `6x`, `avista_d10_20`; `sem_oferta` pelo CRM) em `voz_conversao_dia`. Pagou em 30 dias
  por motivo: o motor manda quem pagou (`nuvem/resultado_motivo.py`) e o banco grava só contagens de dias fechados
  (`voz_resultado_por_motivo`; o site lê por `resultado_por_motivo_voz`, grupo < 30 sem número). Busca semântica:
  serviço contínuo `motorcx-voz-speech-buscas` (`rotina buscas`, a cada 2 s, parte i/n, custo do embedding da pergunta
  na empresa). Webhook pós-chamada da ElevenLabs: receptor dentro do orquestrador real (`criar_receptor`, só com
  `ref_webhook`; 127.0.0.1:8092; HMAC, 2 MB, 10 s; corpo nunca guardado). Proxy HTTPS da VM: Caddy 2.8.4 instalado
  pelo `vm_inicio.sh`, Caddyfile versionado (`infra/asterisk/vm/motorcx-caddy*`), `motorcx-voz-https` liga só as rotas
  dos recursos ligados (webhook; simulador com `motorcx-simulador-fluxo=1`); certificado Let's Encrypt de
  `<ip-com-hífens>.sslip.io:8443` (ElevenLabs e Edge Functions exigem certificado público); firewall 8443/80 no
  `criar_gcp.sh`.
- `motor/propensao.py` (Propensão a pagamento, fase 1): chance de pagar (pagou = 1) em 30 dias por célula
  = situação em D (localização/CPC/giro/quebra) × atraso (0–30…361+) × saldo (tercis), com encolhimento
  Beta célula → situação → carteira (`FORCA` 50). Treino com fotos de toda segunda dos últimos 180 dias
  (LOC, CPA, CPB, NCP, QBR no começo de D, pela trilha; saldo em D = hoje + quitações/parciais depois de D;
  alvo fechado: D ≤ hoje − 30), semanal (domingo, sem modelo, ≥ 7 dias ou dia passado) em
  `estado/modelo_propensao.json` com versão, cortes A–E (quintis das fotos, congelados até o próximo
  treino) e realizado por faixa. Evidência: Coletando (< 30 pagamentos; sem faixa) · Prévia · Definida
  (≥ 200). `rodar_dia` aplica antes da lista (estado/propensao.json, motivos em código), põe
  `propensao`/`faixa_propensao` no enquadramento, a faixa vira o campo "propensao" das etapas
  (`gerar_fila(propensao=)`), agregados por persona (aprendida em `personas.propensao`, da empresa em
  r["propensao"]) e o resumo vai para a execução. Não muda ordem nem canal. Nunca usa idade, sexo, DDD/UF
  nem a persona como variável. SQL 48 (`propensao_carteira`); banco sem ele: grava sem e alerta.
  Entre credores da mesma empresa (mesmo CPF, `pessoa_de`): `rodar_dia(compartilhado=)`
  recebe Hot (pessoa, contato), WhatsApp válido e acionados (pessoa → data); quem outro credor
  acionou há < `recencia_horas` não recebe massiva (`gerar_fila(pausados=)`); devolve
  r["compartilhar"]. No Mac fica em <empresa>/compartilhado/<credor>.json; a foto das 48h é
  a da primeira rodada do dia (estado/outros_credores.json). Rodízio: quem foi adiado (`adiados`
  → "esperando") tem a vez; o credor que acionou por último cede (`_compartilhado`).
- `motor/detectar.py`: layout automático. Empresa sem `empresas/<slug>.json` → `nuvem._layout_automatico`
  monta a Entrada pelos arquivos do credor (cabeçalho: nomes usuais de cobrança; separador,
  encoding, formato de data e decimal pela amostra; DDD em coluna separada; marcas S/N de
  WhatsApp/RCS/Hot por telefone; códigos de CPC da ocorrência; bureau no formato conhecido).
  Sem código de cliente, o CPF acha o cliente mas o ID é o código pseudônimo (`motor/pseudonimo.py`; nunca o CPF).
  Grava config/entrada_automatica.json e põe o que
  entendeu no 1º alerta ("LAYOUT AUTOMÁTICO (confira)", só nomes de coluna). Carga que não
  dá para entender → rejeitados/ + envio com erro listando as colunas. O .json do repositório
  sempre vence.
- Enquadramento: `rodar_dia` devolve r["enquadramento"] {id: estrategia (nome da estratégia do
  segmento ou "Playbook MotorCX"), persona, na_carga, acao_hoje, passo_hoje}; sai em
  estado_cliente (se o banco não tiver as colunas, grava sem elas e alerta). View enquadramento.
- Calendário da localização: o dia em que o cliente chega na carga é o D+1 (`marcacao.dia_na_carga`);
  `rodar_dia` registra as entradas de hoje (`registrar_entradas`) antes da lista, então a 1ª ação
  sai no dia da carga. Playbook: WhatsApp senão SMS no D+1. SMS e RCS só em celular (11 dígitos
  com 9); WhatsApp em fixo só com marca de WhatsApp. Passo sem contato que sirva gera o alerta
  "SEM CONTATO PARA O PASSO DE HOJE". No CPC, o reforço (cpc.junto) acompanha o canal que foi.
- Personas do usuário (tabela `personas_usuario`, por carteira): `cluster.carregar_personas` /
  `persona_de` (mesmas condições dos segmentos; 1ª que bate pela ordem). `rodar_dia(personas_usuario=)`
  põe o nome no atributo "persona" (vale em segmento e no aprendizado) e em
  enquadramento.persona_usuario. Raias (`estrategia.raia`): ações do dia sem "personas" = público
  geral; com "personas": [id] = raia da persona. Cliente cuja persona tem raia no dia recebe só a
  raia dela (sem contato para ela → público geral; `{"canal": "sem_acao", "personas": [id]}` =
  nada no dia); sem raia no dia ou sem persona → público geral (`gerar_fila(publico=)`).
- "Demais clientes" (sem segmento em uso): esteira padrão da carteira (`credores.estrategia_id`).
  `credores.demais_ativo = false` → `rodar_dia(demais_ativo=False)` tira esses clientes da ação
  massiva e do bureau (acordo segue), estrategia "Demais clientes (desligado)" e alerta.
- Início da esteira: `rodar_dia` cria o cliente com `esteira_pendente` (D+1 até a 1ª lista dele
  sair). Ao gerar a lista de hoje, quem teve ação (ou sem contato / sem passo / "sem ação" na
  raia) começa: `inicio_esteira = hoje`; sem contato, adiado por outro credor, fora da carga,
  Demais desligado e domingo seguem no D+1 (`NAO_INICIA_ESTEIRA`). Rodada de novo no mesmo dia
  decide o início de hoje de novo. Sem contato: `fila.por_que_sem_contato` diz canal a canal
  (alerta "SEM CONTATO" e motivo_hoje do cliente). Senão automático (`senao_automatico`, padrão
  ligado): nenhum canal do dia com contato → substituto/reserva do playbook (alerta "SENÃO
  AUTOMÁTICO"). WhatsApp: padrão vai a qualquer celular, número marcado (carga/bureau) na frente;
  estratégia `{"whatsapp": {"so_marcados": true}}` exige a marcação. Alerta "PERFIL DOS CONTATOS"
  (`_perfil_contatos`) em toda rotina. `dia_na_carga` conta de `inicio_esteira` (ou
  da safra, para quem usa o motor direto). Estado antigo: início = 1ª data em escolhas.csv; sem
  escolha e em LOC → pendente. Depois do início, a esteira (localização e giro) só anda em dia
  de lista: `rodar_dia.dias_de_lista` (pastas saida/AAAA-MM-DD em dia útil + hoje) vai para
  `regua.dias_lista`/`hoje_lista`, e `marcacao.dias_de_esteira` conta só esses dias (depois de
  hoje, os dias úteis). Sem `dias_lista` (motor direto/testes): calendário corrido. Preventivo e
  quebra seguem as datas do acordo. Lista vazia: `gerar_fila(motivos=, motivo_de=)` + `previsao()`
  (próximos 7 dias) → alerta "LISTA VAZIA HOJE", resumo.sem_acao/proximos, previsao.json.
- Desempenho: `persona.aprender` conta os valores distintos de cada coluna numa passada (era
  quadrático no nº de clientes: 10 mil clientes levavam minutos a horas); `_qui2` numa passada por
  coluna; `ler_retorno` lê cada data/hora distinta uma vez; `para_json` sem `asdict`. Referência
  (100 mil clientes, 3–5 contatos): a nota de contato tem de custar < 10% da rotina. Mesmo canal no mesmo
  dia e mesma raia: `estrategia._sem_repetir` fica com o 1º e avisa.
- "Reenquadrar agora": o site insere em `pedidos_rotina` (credor_id; status pendente). `ha_arquivo_novo`
  e `empresas_com_carga_nova` incluem os pedidos (o plantão roda em até 5 s, sem o freio de
  `vigia.json`); `vigiar` marca rodando → ok/erro com `execucao_id` (`_fechar_pedidos`). Um pedido
  por carteira na fila (índice parcial); status só a rotina grava. "rodando" há mais de 10 min
  sem rotina segurando a trava (`_rodada_em_andamento`) vira erro.
- Enriquecimento na esteira: ação `{"canal": "enriquecimento"}` em qualquer dia (não na ordem do
  CPC); `gerar_fila(para_bureau=)` separa essa ação da cadeia de contato. `lista_enriquecimento`
  usa o dia programado; sem enriquecimento na esteira, vai na entrada (D+1). Fase do cliente
  desligada (`fase_desligada`): nada vai ao bureau sem a esteira pedir (nem D+1 nem revalidação). Mesmo cliente não
  volta ao bureau antes de `INTERVALO_BUREAU` (30) dias (estado/bureau_enviados.json). Saída
  `saida/<data>/bureau/enviar_bureau.csv` (CPF_CNPJ;ID_CLIENTE). Enquadramento: enriq_enviado e
  enriq_retorno. `prioridade_contatos` na estratégia (critérios ranking/score/whatsapp/rcs/bureau/nota
  asc|desc, score_minimo, ranking_maximo) ordena e filtra os telefones em `candidatos` depois do
  Hot e do rodízio; sem dado do bureau passa e vai depois.
- Segmento × carteira (`segmentos_carteira`): com vínculos, o segmento vale só nas carteiras
  vinculadas com ativo; sem vínculo, regra antiga (credor_id = uma carteira; vazio = todas).
  `clusters.ativo` é o liga/desliga geral. `nuvem.segmento_vale` / `baixar_clusters`. View
  `segmentos_em_uso` resolve vinculado/em_uso por carteira para o site.
- Esteira tolerante: `validar_estrategia` normaliza o que o site gravar (dia "D+3", canal "Agente
  virtual"/"E-mail", modo "senão", números em texto) e descarta só a parte inválida (aviso
  "esteira 'X': partes ignoradas"); a esteira vazia vira aviso. Vigia: `credores_com_orquestracao_nova`
  refaz a lista quando clusters/estrategias/segmentos_carteira/personas_usuario/canais_empresa/credores
  mudam depois da última execução ok (exclusão: gatilho `orquestracao_excluida` carimba
  credores.atualizado_em, porque linha apagada não deixa carimbo). Rotina do dia: a partir de `HORA_ROTINA` (env
  `MOTORCOB_HORA_ROTINA`, padrão 06:00) a vigia roda uma vez cada credor ativo que já rodou e
  ainda não tem execução com `data_ref` de hoje (`credores_sem_rotina_hoje`); erro grava
  `falhou_ate.rotina` e não repete no dia. `publicar_arquivos(limpar=True)` apaga do Storage os arquivos
  do dia (raiz, ids/, bureau/) que não fazem mais parte da lista. Diagnóstico mostra a orquestração.
- Modelos de persona: `regras/personas_modelo.json` (9 hipóteses de mercado, digital × analógico,
  com canais sugeridos) → tabela `personas_modelo` (migração gerada do JSON; teste confere). O
  usuário copia para `personas_usuario`. Atributos calculados para personas/segmentos
  (`rodar_dia.CALCULADAS`): idade (da data de nascimento — que não vira atributo — ou IDADE),
  tem_email, tem_celular, so_fixo, qtd_telefones, tem_whatsapp, tem_rcs, ddd.
- `motor/acoes.py`: ações realizadas. `escolhas.csv` guarda régua, cluster, estado, persona e a
  frase (`frase_id`: id do playbook, 0 = texto escrito na esteira, vazio = sem frase;
  `frase_versao`: 8 caracteres do sha1 do texto/template antes das variáveis) de cada ação exportada; `agregar` cruza com os eventos (ação = dia × cliente × canal;
  evento casa com a ação mais recente do mesmo cliente/canal até `DIAS_BUSCA_ESCOLHA` dias
  antes; ocorrência sem ação vai para a régua `fora_da_lista`). Métricas aditivas por
  data × canal × régua × cluster × persona: enviadas, reservas, com_retorno, retornos, cpcs,
  custo, primeiros_cpc, acoes_ate_primeiro_cpc. `rodar_dia` grava `saida/<data>/acoes.json`
  (60 dias) e alerta "SEM OCORRÊNCIA" quando o último dia útil não teve retorno num canal;
  `nuvem.publicar_acoes` regrava a janela na tabela `acoes_dia` (só totais).
- `motor/estrategia.py`: estratégia de acionamento por cluster (tabela `estrategias`,
  editada no site; `clusters.estrategia_id`; uma pode ser a padrão da empresa). Sobrescreve
  fases do playbook (`localizacao`, `cpc`, `giro`, `preventivo`, `quebra`,
  `recencia_horas`); `Regua.para(cluster)` devolve a régua do cliente. Cada passo é um
  blend de ações `{canal, modo: sempre|senao|junto|reserva, contatos: filtro, numeros}`
  resolvido por `resolver`; passo só com nomes de canal segue o playbook (substituto,
  acompanhante, reserva). Filtros de contato: status, whatsapp, rcs, pertence,
  sem_nao_perturbe, score_bureau_min, origem. Travas fixas: inválido/contestado/"não
  pertence" nunca recebe, trava e freio do WhatsApp, janela, domingo/feriado.
  Limites por canal da empresa (`canais_empresa`): ativo, janela, sábado, capacidade/dia,
  custo, tentativas/dia, Não Perturbe (padrão: voz respeita).
- `motor/entrada.py` + `empresas/<slug>.json`: arquivos da empresa cliente. Base bruta
  (telefones/e-mails em colunas) → `base/clientes.csv` + `base/contatos.csv`. Ocorrência
  (CPC ou não por tentativa, em geral sem o contato) → eventos: o de-para da empresa leva
  o código a um resultado genérico (`cpc`, `sem_contato`, `atendida_sem_cpc`, `terceiro`,
  `invalido`, `opt_out`) e o genérico ao resultado da taxonomia do canal. **O contato é
  marcado por nós:** o motor guarda em `estado/escolhas.csv` o que mandou acionar e liga a
  ocorrência a esse contato; com vários números no dia (voz), a ocorrência vale para a TAG
  mas não certifica número (evento com `contato` vazio, ignorado na certificação).
  Retorno do enriquecimento (seção `enriquecimento` do `<slug>.json`): liga por CPF/CNPJ
  (`base/pessoas.csv`) ou id_cliente; colunas repetidas (FONE, FONE…) lidas pela posição;
  grava em `base/contatos.csv` números novos (origem enriquecimento) e as marcas
  `whatsapp_valido`, `rcs_valido`, `nao_perturbe`, `score_bureau`, `ranking`, `pertence`
  (pelo score, se configurado). Contato novo reativa o giro parado à espera de enriquecimento.
- `motor/normalizacao.py`: ID, CPF, telefone e e-mail na forma canônica.
- `motor/rastreio.py` + `disparar.py`: link rastreável por ação e registro de ações.
- `motor/priorizacao.py` + `rodar.py`: diagnóstico da carteira por valor esperado (base
  para sugerir ao comitê mensal a ordem de rotação por eficiência; não comanda a fila).
- `rodar_dia.py`: **rotina diária** (estado em `estado/`, fila/enriquecimento em `saida/`).
  A saída operacional é `saida/<data>/ids/<canal>.csv`: **`id_cliente;contato` por canal**
  (o contato que o motor escolheu; voz pode ter várias linhas por cliente, na ordem de
  discagem; não há layout de saída por fornecedor). `<canal>_reserva.csv` = só se o canal
  principal do dia não contatar.
- `nuvem/`: sincronização com o Supabase (`python -m nuvem.sincronizar dia|comite
  [--empresa slug]`). Para cada empresa ativa, com pasta própria
  `~/MotorCob-dados/empresas/<slug>/`: baixa os envios pendentes da empresa do bucket
  `entradas`, roda o motor e publica estado, trilha (retomável, pelo marcador
  `estado/nuvem_trilha_enviada.txt`), fila_dia, arquivos em `saidas/<slug>/` e kpis, tudo
  com `empresa_id`. Falha → execução da empresa com status erro, envios dela continuam
  pendentes, e as outras empresas seguem. Chave service_role só em
  `~/MotorCob-dados/config/supabase.env` (criado por `scripts/configurar_nuvem.sh`).
- `nuvem/mistura_operadoras.py`: mistura de operadoras (Console › Fornecedores e rotas, custo previsto) pelos dados
  abertos da Anatel (`acessos_telefonia_movel.zip`, ~3,3 GB: lê só o diretório do zip e o
  `Acessos_Telefonia_Movel_<ano>_<S>S_Colunas.csv` do semestre, ~3 MB, por intervalo de bytes). Celulares = tudo
  menos M2M e PONTO_DE_SERVICO; operadora pelo Grupo Econômico (Telefonica → vivo, Telecom Americas → claro,
  Telecom Italia → tim, resto → outras). Bloco diário da mensageria, a partir do dia 5, uma vez por mês (fonte
  `Anatel (dados abertos) · <mês>/<ano> · celulares`; já tem o mês de dois meses atrás = nem acessa a rede). Edição
  manual no Console vale até o mês seguinte. Falha, soma ≠ 100, salto > 10 pontos ou total < 100 mi: não grava e
  avisa a equipe no sino (chave `mistura_operadoras:<AAAA-MM>`). Manual: `python -m nuvem.mistura_operadoras
  --simular` (só mostra) ou `--forcar`.
- `nuvem/mapeamento.py`: mapeamento por credor feito no site (Credores → Configurações). O
  cliente aponta as colunas de ocorrência, acordo e pagamento (`mapeamento_arquivos`) e marca
  cada resultado de ocorrência (`ocorrencia_codigos`: cpc · terceiro · opt_out · sem marca =
  sem_contato). O motor sugere (`detectar.sugestao_site`: sempre uma das 4 marcas do banco ou nada;
  recado = sem contato; inválido fica sem sugestão; o site não aceita com um clique sugestão fora das 4), registra os códigos e SEGURA o que não está mapeado
  (`<tipo>/aguardando/`, envio com status `aguardando`); quando o cliente confirma, a vigia
  roda e relê tudo. Com `empresas/<slug>.json`, o arquivo já vale como mapeado.
- Retorno de canal (`motor/retorno_canal.py`, `nuvem/retorno_canal.py`): arquivos dos fornecedores
  (envios `canal_sms|rcs|whatsapp|email|voz` → `canais/<canal>/`) só com contato + status, apartados
  do CPC. Mapeamento por credor e canal (`mapeamento_arquivos` tipo `canal_<canal>`; marcas em
  `canal_codigos`: inexistente · temporario · entregue · lido · clique · bloqueio). Viram RESTRIÇÕES
  do contato no canal: DLR de não entregue no SMS → suspensão escalonada do número (7/15/30/90/120 dias,
  depois reabre) em tudo do celular; voz "inexistente" → mesma escada, só na voz (telefonia falha), e
  soma com o SMS (junção: SMS entrou → tudo do celular); RCS sem suporte → fora do RCS, retesta em 60;
  WhatsApp sem conta → retesta em 15; e-mail hard bounce → fora; N temporários → pausa; bloqueio →
  opt_out. Positivo zera. Também evidência na certificação — o próximo contato do cliente assume.
  Nunca entram na esteira/CPC/personas. Regras de
  renitência POR CREDOR em `credores.regras_retorno` ({canal: {...}}; `retorno_canal.PADRAO` é só a
  sugestão; nomes de cada retorno por canal em `retorno_canal.RETORNOS`); trava
  de lote (falha do fornecedor). Saídas: `higienizacao.csv` e `resumo.retorno_canal` na execução.
- Evento que chega depois do dia fechado (ocorrência de ontem enviada depois da rotina) e acordo
  novo valem na mesma rodada (`marcacao.aplicar_pendentes`), uma vez só
  (`estado/eventos_aplicados.txt`). Preventivo: janela = maior dia antes do vencimento desenhado
  na estratégia (o site grava "-5", "-3", "0").
- ON/OFF por fase na estratégia: `localizacao.ativo`, `cpc.ativo` (vira `cpc_ativo`), `giro.ativo`,
  `preventivo.ativo`, `quebra.ativo` — desligado: o segmento não aciona aquela fase (motivo `fase_desligada`;
  o relógio da esteira segue). Frases: `definicao.mensagens = {estágio: {canal: texto}}` (estágios
  localizacao, cpa, cpb, giro, preventivo, quebra) → coluna `mensagem` nos CSV por canal; variáveis
  {saldo} {dias_atraso} {vencimento} {valor_parcela} {qtd_parcelas_abertas}; as outras ficam para a ferramenta.
  Playbook de frases da empresa: tabela `frases` (por canal; importada ou criada na página Canais); a célula
  da estratégia pode ser `{"frase_id": n}` — o texto vem do playbook na rodada (frase desativada não sai).
  Modelo de importação em `docs/modelo_playbook_frases.csv`.
- Acordo por estratégia (segmento): `preventivo.ativo` / `quebra.ativo` (desligado: o segmento não entra em
  PRE; na quebra não aciona e volta ao estoque no prazo), `quebra.carencia` (dias depois do vencimento
  sem baixa que ainda não são quebra; a quebra começa no D+carencia+1), `quebra.dias_para_estoque` e os
  dias livres da esteira da quebra (D+N) e do preventivo (D-N).
- CPC A/B: segue todo dia de lista (sem as 48h das réguas massivas), ou "a cada N dias" pela
  estratégia (`definicao.cpc.intervalo_cpa` / `intervalo_cpb`), contado da última ação de CPC
  exportada (`estado/escolhas.csv`).
- Lista do dia por estratégia: `saida/<dia>/ids/estrategias/<id-nome>/<canal>.csv` + `indice.json`;
  `fila_dia.estrategia` e a view `resumo_fila_estrategia`.
- Calendário de exportação (`credores.calendario`, site → Configurações do credor): dias da semana,
  feriados nacionais (`regras/regua.json`, 2026–2027), datas sem/com exportação; padrão do credor
  e exceção por estratégia (`Regua.com_calendario`). Dia sem exportação: a estratégia não aciona e
  a esteira dela pausa (dias_lista filtrado por estratégia).
- `scripts/` + `docs/PRODUCAO.md`: produção no Mac (instalador, rotina agendada via
  launchd, relatório mensal). `instalar_mac.sh vigiar`: launchd (KeepAlive, sob `caffeinate -i`) mantém
  `rodar_dia.sh --plantao` → `nuvem.sincronizar plantao`, que a cada 5 s (`MOTORCOB_PLANTAO_SEGUNDOS`)
  faz a consulta leve `ha_arquivo_novo` e, com arquivo novo (ou a cada 60 s de qualquer jeito),
  chama `rodar_dia.sh --vigiar`; sai quando o git pull muda o HEAD (launchd sobe de novo).
  `--vigiar` → `nuvem.sincronizar vigiar --checar` (sai 3 sem carga nova) e
  `vigiar` roda o dia só das empresas com envio `base` pendente. Trava em
  `logs/.rodando.lock` (diário e vigia não se atropelam). Rodada com erro grava
  `estado/vigia.json` (`falhou_ate` = id do envio) e só tenta de novo com carga nova. Carga
  sem colunas obrigatórias (`entrada.checar_base`) vai para `bruto/rejeitados/` e o envio
  fica com erro; se todas as cargas novas forem ruins, a rodada para sem gerar lista.
  Credores: `nuvem.credores()` lista os ativos (sem tabela/sem credor = modo antigo, pasta da
  empresa); cada um roda em <empresa>/credores/<codigo>/ (o 'principal' herda a pasta antiga),
  publica com credor_id e saídas em saidas/<slug>/<data>/<codigo>/. Envio sem credor só para
  bureau (vai para todos). A vigia dispara em base/incremental/retirada/acordo/baixa e roda
  só os credores com arquivo novo. Dados reais ficam em `~/MotorCob-dados`, fora do repo.
- `exemplos/simular_operacao.py`: operação simulada dia a dia com verdade conhecida e
  auditoria das regras. `exemplos/gerar_retornos.py`: arquivos de exemplo.
- `db/schema.sql`: modelo alvo em Postgres. `tests/`: testes das regras e princípios.
- `supabase/migrations/`: banco do site motorcob.online no Supabase (projeto próprio, região
  São Paulo), multiempresa: empresas, perfis por papel (admin, planejamento, operacao,
  gestao) com empresa ou equipe MotorCob, envios, execuções, estado_cliente, trilha,
  fila_dia (só IDs), kpis, auditoria de acessos, buckets `entradas`/`saidas` com pasta por
  empresa, e RLS que isola cada empresa. **Nenhuma tabela guarda contato ou CPF de
  devedor**; as listas `ids/` do Storage têm contato (acesso registrado em `acessos`). Só
  a rotina do motor (chave service_role) escreve resultados. `supabase/testes/testar_rls.py`
  verifica as permissões por papel e por empresa num Postgres local. Guias: `docs/NUVEM.md` e
  `docs/PROMPT_SITE.md` (prompt para gerar o site).
- Permissões (migração 20261024): o que cada perfil faz vem de `pode('permissão')` (padrão
  MotorCob em `permissoes_catalogo` + ajuste do Admin em `permissoes_papel`). **Política nova
  usa `pode()`, nunca `tem_papel(...)` fixo** (o teste "nenhuma regra usa mais o papel fixo"
  barra). Permissão nova entra no catálogo da view. Tabela de configuração nova ganha o
  gatilho `z_auditar`. Gestão de usuários: Edge Function `supabase/functions/admin-usuarios`
  (service_role só em variável do servidor). Segurança e pentest: `docs/SEGURANCA.md`.
- Nuvem (Google Cloud, São Paulo): `Dockerfile` (o plantão do Mac num contêiner somente leitura, dados em
  `/dados`, chave por variável de ambiente), `nuvem/gcp/preparar_projeto.sh` (Cloud Shell: registry, Secret
  Manager, rede sem portas abertas, NAT, WIF do GitHub, disco com snapshot, VM) e `nuvem/gcp/vm_inicio.sh`
  (serviços na VM). A imagem é publicada pelo workflow `imagem`. Guia: `docs/NUVEM_GCP.md`.
- Produção recebe o pacote acumulado inteiro (reaplicar uma migração antiga sozinha volta as
  políticas para o papel fixo; a 20261024 precisa ser a última a rodar).

## Status de certificação
CERTIFICADO (certificação + score ≥ 0,7) · PROVAVEL (≥ 0,6) · NAO_CONFIRMADO ·
CONTESTADO (< 0,2) · INVALIDO · DESCONHECIDO (sem evento).

## Roadmap
1. **Feito:** certificação, ingestão por layout, ID do cliente, link rastreável, TAG +
   trilha + réguas + acordos + fila do dia + enriquecimento.
2. **Feito:** KPIs por safra/cluster e Real x Previsto em Excel para o comitê.
3. Acordo pelo operador ligado à ação de origem; webhook/API dos fornecedores.
4. Camada de agentes: Ingestão (quarentena → de-para), Analista, Estrategista, Validador.
5. Calibração com dados reais: pesos de evidência, limiares, prior por origem, taxas.

## MotorCli (frente de Jornada do Cliente do MotorCX)
O MotorCX tem duas frentes sobre a mesma plataforma: MotorCob (este playbook de cobrança) e MotorCli
(jornada do cliente). A carteira do MotorCli é uma linha de `credores` com `frente = 'motorcli'`; a rotina
(`nuvem/sincronizar.py`) roda `rodar_jornada.py` em vez do `rodar_dia.py` e publica a mesma Lista do dia
(`fila_dia`, `ids/<canal>.csv`), as ações (`acoes_dia`), o enquadramento (`jornada_cliente`) e os lotes da
Mensageria. Regras em `regras/jornada.json` (propostas, a validar em comitê; mudar regra = decisão + commit):
- Momentos, nesta prioridade: pré-vencimento (D-5 a D0; quem pagou sai) · boas-vindas (0 a 2 dias da
  contratação) · ativação (3 a 30 dias, só quem não ativou) · retenção (30 a 89 dias sem atividade) ·
  reativação (90 a 365 dias sem atividade).
- No máximo uma ação por cliente por dia; um passo por vez (o passo perdido sai até o dia do seguinte);
  recência de 48h entre ações, exceto pré-vencimento; dia sem janela no calendário não gera lista.
- Cliente com `dias_atraso > 0` fica com a cobrança (MotorCob); bloqueio tira o cliente de tudo.
- Contato: o de maior nota da certificação (Hot primeiro), sem restrição do canal (retorno de canal e
  descadastro da Mensageria), nunca o contestado; WhatsApp só com `whatsapp_valido = sim`.
- Canal "melhor": ordena as opções pela taxa de contato efetivo da carteira quando o canal tem ≥ 200
  tentativas; sem evidência, a ordem da regra. Sem contato no canal (ou canal desligado): o "senão".
- Estratégia do site (`estrategias` com `frente = 'motorcli'`): liga/desliga momentos, troca passos e a
  recência; inválida → roda o padrão e avisa.
- Base: `id_cliente;data_contratacao;proximo_vencimento;vencimento_pago;ativado;ultima_atividade
  [;dias_atraso][;bloqueio]` · contatos no mesmo formato da carteira.
- Comando: `python rodar_jornada.py --clientes exemplos/jornada/clientes.csv --carteira
  exemplos/jornada/contatos.csv --data 2026-10-13`

## Site (motorcob.online)
O site (página comercial + app: Workspace, Orquestração, Mensageria, Console) vive em `site/` e é publicado no
Netlify como site estático (React Router em modo SPA, `site/netlify.toml`). **O Horizons não é mais a fonte da
verdade**: mudança no site é commit aqui. Dados só pelo Supabase com a chave anon e a RLS; nada de service_role
no site. O formulário de contato grava em `contatos_site` (SQL 29 + SQL 52). Como rodar, variáveis e deploy:
`site/LEIA.md`. CI: `.github/workflows/site.yml` (lint + typecheck + testes + build).
Argumentos das RPCs: `scripts/conferir_rpc.py` lê toda chamada `rpc('nome', {...})` do site, das Edge Functions e do
Python e confere os NOMES dos argumentos com a assinatura vigente nas migrações (sobrecargas, defaults, drops); o PostgREST
acha a função pelo nome dos argumentos. Roda no job `motor` (`tests/test_conferir_rpc.py`) e no `banco` (`--banco`, contra
o catálogo). Argumento que não dá para ler precisa de comentário `conferir-rpc: <motivo>` na chamada.
Colunas: `scripts/conferir_colunas.py` lê toda corrente `x.from('tabela')` do site e das Edge Functions (`.select('a,b')`,
chaves de `.insert/.update/.upsert` com objeto literal ou variável local, `onConflict`, `.eq/.in/.order/.or/.match`…) e confere
os nomes com as tabelas/views vigentes nas migrações (create/alter/rename/drop, views, colunas calculadas `f(tabela)`);
mesmos jobs (`tests/test_conferir_colunas.py` e `--banco`). Escape: `// conferir-colunas: <motivo>`.
Erro de Edge Function no site: sempre `erroDaFuncao(error, data)` (`site/src/lib/funcoes.ts`), nunca `friendlyError(error)`
direto: no status != 2xx a frase `{ erro }` da função está em `error.context` (Response).
SQL 71: `cancelar_rascunho(fatura)` (rascunho → cancelada; quem emite a fatura da empresa).
SQL 72: `estimativa_ciclo` não projeta por dia o que conta uma vez no ciclo (Orquestração por CPF, Jornada): fixo + medido
+ consumo × dias do ciclo ÷ dias corridos; a conta vive em `estimativa_ciclo_em(empresa, hoje)` (só o servidor).
SQL 73: o CPF nunca é o id do cliente (`parece_cpf`, `id_cliente_pseudonimo`, `rechavear_clientes`, check em toda tabela com
id_cliente; troca o que já estava gravado) e o rascunho cancelado (nunca emitido) não segura mais a competência:
`gerar_rascunhos`/`fechar_fatura` geram outro (`competencia_tem_fatura`; único só entre as não canceladas).
Empresa › Faturas monta o painel do banco (`site/src/lib/faturamento-painel.ts`; a função `cobranca` não tem ação "painel").
Fluxo do agente (Cobrança › Canais › Agente virtual; SQL 58, 59 e 66): `site/src/components/fluxo/` e `site/src/lib/fluxo.ts`;
quadro por ramos, "Enviar para aprovação" bloqueado enquanto `fluxo_voz_bloqueios` tiver pendência; conectores em
Empresa › Integrações (cadastro e credencial só da equipe). O roteiro antigo segue em `/canais/agente-virtual/roteiro`.
SQL 66 também: descartar o pedido em texto (`cancelar_pedido_fluxo_voz`), job noturno das métricas do fluxo
(`agregar_fluxo_dia` pelos passos e chamadas; `voz/fluxo_metricas.py`, timer `motorcx-voz-fluxo-noite` 02:50, nos dois
acessos), resposta escolhida do conector no simulador (`cenarios`: sucesso/tempo/401) e "Ouvir a voz" (`/ouvir` na VM,
TTS ElevenLabs da Montagem, áudio nunca guardado; uso em `registrar_uso_ia_voz` componente `previa_voz`).
Geração do fluxo por texto (`voz/gerar_fluxo.py`): serviço contínuo `motorcx-voz-gerar-fluxo` da VM
(`motorcx-voz-rodar gerar-fluxo`, metadado `motorcx-gerar-fluxo=1`, chave `motorcx-voz-llm-fluxo`), nos dois acessos;
reiniciado pelo `motorcx-voz-atualizar` (05:35) quando a imagem muda. Pedido livre (prompt de persona) vira fluxo
compacto (abertura → identidade → UMA generativa → finais; valores do texto viram pergunta da alçada). Reparos de
forma sem mudar sentido em `aplicar_travas` (título 60, repetir_max 1..5, chaves fora do esquema, tipo/rótulo da
saída, falhou/sem_resposta/nao_entendido → Transferir · atendente, bloco sem caminho sai; tudo em suposições);
correção ao LLM bloco a bloco em português (`explicar_erros`); `resultado.erros` continua em códigos.
Go-live (SQL 67): `voz_troncos.segredo_ref` começa com `voz/` (trigger só quando a referência muda; site igual);
`criar_gcp.sh` cria a `motorcx-gravacoes-leitura` (leitura dos buckets; `chave-leitura` gera o `GCS_GRAVACOES_CHAVE`
sem mostrar), a conta da VM lê `motorcx-voz-*` e `motorcx-crm-*` e chama a Vertex (`roles/aiplatform.user`);
`vm_inicio.sh` instala `provedores.json` padrão (Montagem) e `provedores_sip.json` vazio só quando faltam; CSP do
site gerada no build (`site/scripts/cabecalhos.mjs` → `_headers`, scripts inline por hash) e HSTS no `netlify.toml`.
SQL 68: a equipe MotorCX com `responder_chamados` (a mesma de `entregar_pedido_fluxo_equipe`; Master tem todas) monta
o fluxo do cliente no alcance — cria, edita o rascunho, duplica, base de respostas, casos de teste, testa (simulador e
roleplay) e envia para aprovação. Tudo por `pode_editar_fluxo_voz`; aprovar, colocar em uso, voltar versão, revisar a
resposta da base e a alçada continuam só do cliente (`pode_aprovar_fluxo_voz`). Site: `permissoesFluxo` em
`site/src/components/fluxo/contexto.tsx`. Se o SQL 58 for rodado de novo, rode o 68 depois.
SQL 69 (decisão do dono): a Orquestração é cobrada SÓ por CPF = preço × CPFs distintos que estiveram na carteira em
cobrança (na_carga) em pelo menos um dia do ciclo; mesmo cliente em várias rodadas, vários contratos ou o mesmo CPF
em duas carteiras da empresa contam UMA vez; quem saiu para de contar no ciclo seguinte. `nuvem/faturamento.py`
(`publicar_clientes`) grava `clientes_mes` com a chave HMAC-SHA256(sal da empresa em `faturamento_sal`, só a rotina
lê; `chave_pessoa` do CPF da carteira ou o id_cliente): nunca CPF, nome ou telefone (check de 32 hexadecimais).
`previa_fatura` conta distinct por empresa ("Orquestração · CPFs ativos no mês", unidade 'CPF'); ciclo medido só
antes do SQL 69 segue pelos contratos; fatura fechada não muda. `contratos_mes` continua (informativo no demonstrativo).

SQL 74 (Assistente de implantação, aprovado pelo dono): `/implantacao` (site/src/components/implantacao/, regras em
`site/src/lib/implantacao.ts`), 5 passos com o progresso em `implantacao_progresso`. `criar_empresa_implantacao` cria
empresa + módulo + ciclo padrão + preço por CPF + contato numa transação, idempotente pela `chave` (e pelo CNPJ);
`salvar_carteira_implantacao` renomeia a "Carteira principal"; `salvar_canais_implantacao` grava quem envia
(`canais_empresa.quem_envia`: lista = a empresa baixa a lista e o fornecedor dela envia, motorcx = Mensageria; NULL = como
antes) e `mensageria_config.aprovar_primeiro`; `implantacao_situacao` alimenta a lista "O que falta". Mapeamento da carga
geral: `mapeamento_arquivos.tipo = 'base'` (`salvar_mapeamento_base`, colunas validadas; o código do cliente nunca é a
coluna do CPF); o motor lê o salvo em `nuvem.mapeamento.mapa_base` e passa para `detectar.layout_base(fixas=)`: o salvo
vence, a detecção completa o resto (coluna que sumiu volta para a detecção). Carga que não dá para ler ESPERA em
`<bruto|incremental>/aguardando/` (envio "aguardando" com "Faltou apontar N colunas…"), nunca é rejeitada; salvar o
mapeamento abre um pedido de rotina. Lote da Mensageria não nasce para canal com quem_envia = lista; SMS sem frase na
esteira usa a frase ativa da etapa (`frases.estagio`). Menu: Discagem → "Regras de discagem"; ⌘K com sinônimos e sem acento.

SQL 75 (Orquestração, relato do dono): "Trocar estratégia" (segmentos_carteira.estrategia_id = null; volta às três opções e a
estratégia fica na empresa) e "Excluir estratégia" (`excluir_estrategia`, só se `usos_estrategia` não acha outro segmento ×
carteira, Demais clientes ou padrão; senão só Trocar); `criar_estrategia_segmento` cria com o nome da tela ("<Modelo> ·
<Segmento>"); `separar_estrategia` não corta mais a carteira em 16 letras. Estágios no site = o que o motor faz
(`site/src/lib/estagios-regua.ts`): fase sem a chave `passos` segue a régua padrão do motor, `passos: {}` = ninguém da fase
recebe ação, etapa sem régua é ignorada; os passos Estágios, Régua e Revisar mostram a MESMA lista (nomes, ordem, ligado) e
salvar nunca grava `passos: {}` numa fase que não tinha (`porFaseComPassos`). "Montar esteira pelas personas": por estágio,
só em estágio com dias, aplica no editor (Salvar grava).
Raias por persona dentro do estágio (etapa 1 do plano de IA): no passo Régua o estágio escolhido (fase com dias ou estágio
próprio) mostra SÓ a sua grade — Público geral + uma linha por persona com raia, "+ Raia de persona" (copia o Público geral
em cada dia; Salvar grava), colunas = dias do estágio ("D+N · Dia N" no Cliente novo; "Dia N do ciclo" + "↻ × N" no Não CPC
e no estágio próprio com ciclo). Estágio próprio usa a mesma grade (sem o antigo `EtapaReguaEditor`). Regras da tela em
`site/src/lib/raias-estagio.ts`; ordem dos canais na célula (sempre/senão/junto/reserva) e raia da persona pinadas pelos
mesmos casos no motor e no site (`tests/dados/raias_semantica.json`, `tests/test_raias_estagio.py`, `raias-estagio.test.tsx`).

SQL 76 (etapa 2 da IA na Orquestração, aprovada pelo dono): reavaliação diária dos segmentos com dias de atraso (motor) e
prévia de cobertura `previa_segmentacao` (ver `motor/cluster.py` acima). Site, Segmentação: três cartões iguais (Novo
segmento · Usar segmento da empresa · Descrever segmentos e régua, ligado na etapa 5 / SQL 79;
`components/clusters/caminhos-segmentacao.tsx`); no formulário do segmento, "clientes hoje" ao vivo pela prévia
(`lib/previa-segmentacao.ts`: monta a lista em uso da carteira na ordem com o segmento editado no lugar dele). Ordem de
implantação: banco (SQL 76) antes do motor; motor sem o banco só alerta; site sem o banco esconde a estimativa.

SQL 77 (Etapa 3 da IA na Orquestração, decisão do dono): recuperação por ação para otimizar "valor recuperado por real".
`motor/recuperacao.py` (rodar_dia → `recuperacao.json`; `nuvem/sincronizar.publicar_recuperacao`) grava `recuperacao_dia`
e `contato_posicao_dia` (só agregados; sem id, telefone ou CPF). **Regra de atribuição:** o acordo nasce no dia da rotina
que o viu pela 1ª vez nas parcelas (`estado/acordos_vistos.csv`, local, gravado uma vez; o que já existia quando o
controle começou é "legado" e segue a regra do comitê pela trilha) e vai para o ÚLTIMO TOQUE COM CPC nos 7 dias antes
dessa rotina (sem CPC, o último toque; empate no dia: canal marcado na trilha, depois a ordem de rotação); sem toque
(inclusive acordo que veio na carga) → regua `sem_acao`, canal vazio. Pagamento = parcela paga (promessa não é
pagamento) e vai para a linha do acordo; pagamento que chega depois atualiza o dia da AÇÃO: a rotina recalcula e regrava
180 dias (idempotente) e apaga o que passou de 760 dias. Ação e retorno → ação = as do `acoes_dia` (mesmo número de ações e
CPC). volta/dia_ciclo vêm do passo exportado (`escolhas.csv` ganhou a coluna `passo`). RPCs (security definer;
`pode_ver_empresa` + `pode('ver_painel')`; taxas só com ≥ 30): `recuperacao_por_acao(empresa, de, ate, credor, agrupar,
so_canal, so_regua, so_cluster, so_persona)`, `contato_por_posicao`, `respostas_por_hora` (Mensageria, hora de Brasília);
`limpar_recuperacao(dias)` só do servidor. Site: Resultados › Painel › "Recuperação por canal e persona".

SQL 78 (etapa 4 da IA: créditos de IA, decisão do dono 07/11/2026; SPEC do Especialista §11): franquia de créditos por ciclo
do faturamento da empresa (`cobranca_itens.franquia_padrao` = 100 no item `ia_creditos`; `precos_empresa.franquia`, nulo = a
do item, herdada pela vigência nova) e excedente a preço único (tabela R$ 1,90, nunca abaixo de `preco_minimo_ia`; impostos =
`parametros_margem.impostos_pct`, nada fixo). Pesos em `ia_creditos_funcoes` (análise 2 · Descrever 2 · pergunta 1 · pré-análise,
standby, explicar, respostas por opção e cache 0; mudar peso = commit). `ia_creditos_uso` (só quantidade; `pedido_ref` único
`esp:analise:<id>`…): `reservar_creditos_ia` (site: quem vê a empresa; Descrever pede `editar_orquestracao`; standby só do
servidor) → `confirmar_creditos_ia` na transação do resultado (crédito em `consumo_mensageria` na competência do ciclo; custo
real em `consumo_ia`, `ia_creditos` ou `ia_sem_credito`, uma vez) ou `estornar_creditos_ia`; reserva parada 15 min deixa de contar
e o plantão estorna (`estornar_creditos_ia_vencidos`, a cada 10 min); `registrar_uso_ia` = reserva + confirma (servidor). Avisos
no sino em 80% e 100%, uma vez por ciclo (chave `creditos_ia:<empresa>:<competência>:<nível>`). Nunca bloqueia, salvo o teto do
Master (`empresa_limites_ia`, `salvar_limites_creditos_ia`). Fatura: "Créditos de IA (franquia de N, incluída no contrato)" sem
valor + "Créditos de IA excedentes · N × R$ X" (`linhas_fatura_creditos_ia` dentro de `previa_fatura`); `margem_ia` compara a
receita do excedente com o custo só das unidades pagas; `margem_creditos_ia` mostra ao Master a franquia (custo na
mensalidade), o excedente e o custo do sistema. Site: contador e aviso em `components/ia/creditos-ia.tsx` (regras em
`lib/creditos-ia.ts`, `rotuloCreditos` para os botões das etapas 5 e 6), Empresa › Uso de IA (`/empresa/uso-ia`, view
`ia_creditos_ciclo` + `uso_ia_empresa`) e Console › Margem › Itens de IA › Créditos. Os itens de IA que já existiam
(`ia_geracao_fluxo`, roleplay, Speech Analytics) seguem como estão. Se o SQL 61 ou o 69 rodarem de novo, rode o 78 depois.

SQL 79 (etapa 5 da IA: "Descrever segmentos e régua", decisões do dono 07/11/2026; protótipo proto-segmentacao v2): na
Segmentação, um texto (até 6.000 caracteres) → `pedir_segmentacao` grava em `segmentacao_pedidos` (um em andamento por
carteira) e RESERVA 2 créditos (`seg:geracao:<id>`, função `descrever_segmentos` do SQL 78; sem item avulso). Na VM,
`voz/gerar_segmentacao.py` (serviço `motorcx-voz-gerar-segmentacao`, metadado `motorcx-gerar-segmentacao=1`, mesma chave do
LLM do fluxo, nos dois acessos: `voz_vm.pegar_pedido_segmentacao`/`registrar_segmentacao`) pega o pedido com o contexto SEM
dado pessoal (segmentos da carteira, campos, valores distintos de texto com contagem, canais com estado, personas com o
mapeamento, `hash_segmentacao`), chama o LLM com UMA ferramenta (`entregar_segmentacao`, esquema estrito; texto do cliente
entre marcas, como dado) e compila com `motor/segmentacao_ia.py` (determinístico): ordem final com os segmentos não citados
no lugar, código único na empresa, condições por `cluster.ler_condicoes` (número JSON; `$ticket` = saldo, parcela só se o
texto disser), régua por fase (Cliente novo/Não CPC com ciclo/CPC/Acordo padrão, nunca `passos: {}`), raias por persona
(mapeamento = N-ésimo canal disponível), limites do editor, `estrategia.validar_estrategia` + `etapas.validar_fases`; erro →
até 2 correções. O que não existe vai para `fora` (campo, canal desligado/não contratado, persona, oferta, recorte com 0).
Cada opção de pergunta é compilada de novo e vira patch sobre a proposta (`caminho` → `valor`), que o site aplica sem IA
(`lib/segmentacao-ia.ts`; paridade em `tests/dados/segmentacao_proposta_dono.json`). Com proposta o banco confirma os
créditos; sem, estorna; descartar estorna. `aplicar_segmentacao(pedido, proposta, previa_hash, carteiras_extra)`: UMA
transação (falha no meio não deixa nada), recusa hash velho e canal "a ativar" desligado, snapshot em
`segmentacao_aplicacoes`, novo/alterar/desligar (só nesta carteira)/ordem/estratégia por `criar_estrategia_segmento`
(a antiga fica)/Demais/cópia nas carteiras extra; tudo que é novo ou alterado nasce PAUSADO (`segmentos_carteira.ativo =
false`) até `ligar_segmentacao`; `desfazer_segmentacao(aplicacao, forcar)` volta do snapshot (criados ficam desligados) só
até a próxima rotina, com conflito listado. Permissão: `pode_descrever_segmentacao` = vê a empresa + `editar_orquestracao`
+ admin/planejamento. Site: `components/segmentacao-ia/` (telas 2–6 e a faixa "Aplicado" com Ligar/Desfazer/Reenquadrar).
**SQL 82 (decisão do dono, 08/11/2026): segmento alterado segue valendo até ligar.** Só segmento NOVO (e a estratégia
dele) nasce pausado. Segmento atual que está valendo (em uso em alguma carteira) e foi alterado não é mexido no Aplicar:
a versão nova (nome, condições, flags) e a estratégia nova (criada, mas o vínculo fica na atual quando o segmento vale
nesta carteira) ficam em `segmentacao_aplicacoes.criados › espera › versoes`; segmento atual pausado em todas é alterado já
e segue pausado. Com algo para ligar, a ordem nova, os desligados nesta carteira (inclusive o compartilhado do padrão
"desligar aqui + criar novo", que segue aqui até ligar e nas outras carteiras sempre) e o Demais também esperam;
sem nada para ligar, valem na hora. `ligar_segmentacao` troca tudo numa transação (ordem no 1º Ligar; desligar e Demais
quando não sobra nada). Aplicar de novo com uma aplicação esperando substitui a espera dela (`substituida_por`).
`desfazer_segmentacao` volta do snapshot (conflito = mexido depois da última escrita da aplicação, `criados › marcas`;
restaura só o que mudou) e APAGA os segmentos e estratégias que ela criou e ninguém mexeu nem ligou em outra carteira
(código e nome livres de novo: a geração seguinte reusa D90B e o nome sem "(2)"). Motor sem mudança (só lê `clusters` e
`segmentos_carteira`). Site: "vale ao ligar" na revisão e "versão nova espera" na faixa (`efeitoAplicar`,
`esperaAplicacao` em `lib/segmentacao-ia.ts`); o editor da régua ainda mostra a versão que vale hoje.
**SQL 84 (Canais, SPEC §6.2 PRs 4 e 5; padrões aprovados pelo dono em 08/11/2026): estado dos canais.**
`estado_canais(empresa)` (security definer; `pode_ver_empresa` + `editar_canais` ou equipe; só agregados) devolve por canal
`{canal, grupo, quem, estado, motivo, problema, o_que_fazer, acao, ultima_atividade, sinais[], problemas[]}` e o `resumo`.
Estado (o mais grave vale): pausado (`canais_empresa.ativo = false`) > não configurado (canal não liberado na Mensageria /
RCS sem verificação, nunca enviou, Voz sem `voz_config`, sem tronco ativo ou sem rota vigente) > com problema (entrega
24 h < 80% ou 15 pontos abaixo da média dos 7 dias anteriores, com ≥ 30 mensagens; orçamento do centro da Lista do dia
> 90% com "bloquear"; retorno do fornecedor sem chegar há mais de 1 dia útil, `dias_uteis_entre`; código de retorno sem
mapear; rota de voz pausada; tronco com `configuracao_invalida`) > atenção (orçamento no alerta, lote de hoje esperando
aprovação ou pausado, simulação / só números de teste, rota sem cadastro, freio por abandono, chamadas curtas ≥ 70% em
7 dias) > funcionando. `quem`: `quem_envia` (nulo = MotorCX no que a Mensageria cobre), `voz_motorcx` com o módulo
`agente_voz`, senão lista. Site: `/canais` é a visão geral sem campos (`components/canais/visao-geral.tsx`, rótulos e
rotas das ações em `lib/estado-canais.ts`); "Configurar" abre `/canais/:canal` (a tela do canal, SQL 86). Editar Canais e
Frases = `editar_canais`.
**SQL 86 (Canais, SPEC §6.2 PRs 6 e 7): a tela do canal.** `/canais/:canal` (`components/canais/canal-tela.tsx`, regras em
`lib/canal-tela.ts`): topo com o estado (`estado_canais`), última atividade, 4 sinais, problema + "o que fazer", Pausar /
Retomar (`canais_empresa.ativo`) e "Testar agora" desligado ("em breve", PR 9). Seções fechadas com resumo, só as do canal
(§4.3, `secoesDoCanal`): Regras de envio · Mensagens (o editor de frases, com `AvisoIdentidade`; RCS sem aparelho) · Lista
e retorno do fornecedor (mapeamento e códigos, por carteira) · Retorno do canal (`credores.regras_retorno`, por carteira;
`editar_credores`) · Custos e limites (centro de custo da Lista do dia) · Conexão (técnico, leitura). Cada seção grava só
os seus campos ("Salvar <seção>"); "Configuração de:" Empresa ou carteira com "da empresa" / "desta carteira · voltar ao da
empresa" (`ajustesCarteiraSecao` preserva o ajuste das outras seções). Retorno e mapeamento continuam também na carteira;
centro de custo e RCS sem aparelho, também em Mensageria (1 ciclo). `/canais?secao=frases` = só as frases
(`frases-pagina.tsx`, `?canal=`); Importar playbook só no topo da visão geral. Banco: `canais_empresa.pausado_em` /
`pausado_por` (gatilho `canal_pausado_desde`: grava ao pausar, apaga ao retomar, ninguém escreve à mão; o já pausado ganhou
o `atualizado_em`), `estado_canais` usa o `pausado_em`, e `credor_canais` grava com `pode('editar_canais')` (era papel fixo).

**SQL 96 (PR9 do redesenho do fluxo; SPEC B4 e Q4): trava de CPF.** O agente nunca fala, pede nem repete CPF (o CPF
nunca é identificador e o site nunca mostra nem busca por ele). Fala do fluxo: `fluxo_voz_aux_pede_senha` =
`voz/fluxo_validador.pede_senha`/`pede_cpf` = `site/src/lib/fluxo.ts › pedeCpf` (casos em `tests/dados/trava_cpf_casos.json`):
citar CPF ou dizer um número com cara de CPF dá `fala_pede_senha`; só "os três últimos números/dígitos do CPF" (identidade)
pode. Executor: `Sessao.render` troca a fala (trava `cpf`); a IA conversa e a Conversa do roteiro também cortam (`FIXA_CPF`).
Pessoa: `redacao.cpf_dito` (formato, 11 dígitos com DV, por extenso, ou "CPF" + 9 dígitos) é a 1ª trava em `_travas`:
responde `FALA_CPF` (na identidade pelos 3 últimos, pede só os 3), a etapa continua esperando, o texto nunca vai ao modelo;
`ConversaComTurnos` guarda só `[CPF REDIGIDO]` e o simulador devolve a marca. `travas_voz()` e `voz_fluxo_passos.trava` + 'cpf'.
Se o SQL 58 ou o 59 rodarem de novo, rode o 96 depois.

**SQL 87 (pedido do dono, 08/11/2026): Agente de voz e Speech Analytics na Contratação.** A Contratação (cadastro novo e
edição; `editar_contratacao`) tem as chaves "Agente de voz" e "Speech Analytics" (linhas e textos em
`lib/contratacao-modulos.ts`), gravadas em `empresa_modulos` (`agente_voz`, `speech_analytics`). `voz_config.speech_analytics`
(o que a VM lê) segue o módulo: gatilhos `speech_do_modulo` (empresa_modulos → voz_config, só se a empresa já tem
voz_config; ninguém cria voz_config por aqui) e `modulo_do_speech` (voz_config nova nasce com o módulo; o `update` à mão do
Master leva o módulo junto). Backfill: `voz_config.speech_analytics = true` virou módulo ativo. Site: a área Speech
Analytics depende do módulo (`useAreasLiberadas().speech`, `areaDoContrato('speech')`), com a página "não faz parte do
plano" e "Avisar o Admin" (`avisar_admin` aceita `speech_analytics`); as Gravações seguem com a Cobrança
(`contratoDaRota`). O item `ia_speech_analytics` é do módulo `speech_analytics` (preço nenhum mudou).

**SQL 83 (decisões do dono, 08/11/2026; SPEC §6.1 B4, B6, B7): destinos perigosos, gravação e identidade antes da dívida.**
B4: host do tronco e da transferência nunca interno, reservado, de loopback ou do MotorCX (`voz_enderecos_motorcx`, a equipe
cadastra os IPs das VMs) — gatilho `voz_destino_seguro` no cadastro/mudança e, na VM, `voz/destinos.py` de novo DEPOIS do
DNS (`configuracao.buscar` e o gerador deixam de fora sozinho o que não passa). Número: só nacional 10/11 dígitos com DDD
válido (`destinos.motivo_numero` no orquestrador; plano do Asterisk com `_[1-9][1-9]9XXXXXXXX` e `_[1-9][1-9][2-5]XXXXXXX`,
sem `_X.`). B6: `aviso_gravacao` ligado por padrão; a abertura diz "Esta ligação é gravada. Sou o assistente virtual da
{empresa}." (`provedores/base.py › aviso_abertura`, antes da 1ª fala); retenção 90 (teto) e `retencao_prova_dias` (até
1.825) só para gravação com `prova` (promessa ou contestação; gatilhos acompanham). B7: `motor/trava_identidade.py` =
`public.texto_revela_antes_identidade` (casos em `tests/dados/trava_identidade_casos.json`): recomendação e relatório
do Speech nunca sugerem credor/dívida antes da identidade; a Montagem sem fluxo corta a fala (`Conversa._travar`) e o
fluxo corta o credor escrito à mão (`Sessao._credor_literal`). Se o SQL 56 rodar de novo, rode o 83 depois.

**PR10 do redesenho do fluxo (SPEC B6 e Q9, sem SQL): a voz da ligação diz números por extenso e os áudios do sistema
saem da voz do agente.** Todo texto que vai ao TTS na ligação passa por `voz/falado.como_soa` (`montagem.para_tts`; o
Pipecat recebe `ConversaFalada(s.conversa)`): valores, datas, horas, parcelas e percentuais como o "Como soa no telefone"
(mesma tabela `tests/dados/fala_por_extenso_casos.json`); a transcrição e os eventos guardam o texto escrito. A prévia
"Ouvir" da VM também. `sem-robo.wav` e `alo.wav`: `motorcx-voz-sons` na VM (`voz/sons_sistema.py`, chave `motorcx-voz-tts`
do cofre, WAV 8 kHz mono 16 bits em `/var/motorcx/sons`, montada no Asterisk); comando no README do Asterisk, seção 4.

**SQL 85 (decisão do dono, 08/11/2026): mensagem escrita sem a dívida antes da identidade.** SMS, WhatsApp, RCS e e-mail
chegam inteiros a quem está com o telefone: nenhum texto PADRÃO do MotorCX cita dívida, saldo, valor, parcela, vencimento,
credor ou contrato. SMS padrão do Assistente de implantação (`FRASES_PADRAO_SMS`): "Olá, {primeiro_nome}. Você tem uma
mensagem da <empresa>. Acesse: {link}" e variações por etapa ({primeiro_nome} e {link} a ferramenta do canal preenche); o
detalhe fica atrás do link autenticado. Trava: `motor/trava_identidade.py › motivos_mensagem` = `public.mensagem_revela_divida`
= `site/src/lib/identidade-mensagem.ts` (casos em `tests/dados/mensagem_identidade_casos.json`; usa a B7 e soma variáveis
de chave simples e palavras como parcela/acordo/negociar; o nome da empresa vira {empresa}). Os testes (unittest e npm test)
barram padrão novo que revele; nos editores do cliente (Canais › Frases, Orquestração, Jornada, Mensageria, Assistente) é
só AVISO (`AvisoIdentidade`), o texto é do cliente. O SQL não reescreve nada salvo: lista os ids no raise notice.

**SQL 88 (padrões aprovados pelo dono em 08/11/2026; SPEC "mailing", parte IDENTIDADE): o agente de voz confere a
identidade pelo arquivo.** Por carteira (`voz_mailing_config.identidade`, credor nulo = empresa toda, versões com "o que
mudou" e `z_auditar`; salva só quem aprova o roteiro de voz, `salvar_config_mailing_voz`): quem confere (`crm` ·
`arquivo` · `crm_arquivo` · `arquivo_crm`), quantas perguntas (1 · 2), quais na ordem (dia/mês, 3 últimos dígitos; ano
como reserva), se faltar dado (`proxima` · `menos` · `transferir`) e erros no dia (3 · 4 · 6). **Sem configuração o
executor faz exatamente o de hoje** (teste de paridade). Carga: colunas `nascimento` e `documento_validacao` (pode ser a
do CPF) no mapeamento; viram código e somem (`motor/identidade_mailing.py`: HMAC-SHA256 com a chave PRÓPRIA da empresa
no Secret Manager `motorcx-voz-identidade-e<id>`, domínio + empresa + id + pergunta, 32 hex; nunca o `faturamento_sal`)
em `base/identidade.csv`; nunca viram atributo, prévia ou saída (risco R1; `previa.PESSOAIS` ganhou ULT3/DIG/DV…).
A rotina publica só os códigos da lista de hoje do agente (`nuvem/identidade_voz.py` → `publicar_identidade_voz`; nunca
no Storage). **A comparação é no banco:** a VM (`voz/conector.FonteArquivo`, fonte interna) calcula o código da resposta
e chama `conferir_identidade_voz`, que só responde dentro de uma ligação aberta (`abrir_identidade_voz`, 30 min), conta 2
tentativas por pergunta e o limite do dia somando as ligações, e devolve só a palavra. Ninguém lê os códigos (site,
service_role e `motorcx_voz` sem acesso). "Não confere" nunca troca de fonte; falha ou sem dado, sim. Trava das ofertas
do arquivo (ainda não construídas): `identidade_mailing_confirmada`. Limpeza no job noturno da VM (`limpar_identidade_voz`).
Chave: `docs/NUVEM_GCP.md` › "Chave de identidade do agente de voz". Testes: `tests/test_identidade_mailing.py` e
`supabase/testes/testar_identidade_mailing.py`. Se o SQL 58 for rodado de novo, rode o 88 depois.

**SQL 89 (Roleplay de treinamento, PR 1; SPEC aprovada pelo dono): perfil "Qualidade", só a área Speech Analytics.**
Pessoa da empresa cliente (papel `qualidade`). **Vale no banco, não só no menu:** `minhas_empresas()` não devolve a
empresa para a Qualidade, então toda policy/RPC de fora do Speech já nega; `minhas_empresas_speech()` (= minhas_empresas
+ a empresa da Qualidade) só nas tabelas e RPCs que as telas do Speech leem (gravações, insights, temas, checklist,
recomendações, `empresa_modulos`, `painel_speech`/`qualidade_voz`/`operadores_voz`/`operador_voz`, `acesso_da_empresa`)
e em `cliente_pode(empresa, perm)` quando `perm` é do Speech (`permissoes_speech()`: ouvir_gravacoes, ver_transcricoes,
ver_operadores, ver_alertas, curadoria_voz, editar_checklist). Padrão da Qualidade = `permissoes_qualidade()` (as mesmas
menos editar_checklist), pelo `permissao_padrao()` (o catálogo continua com 4 colunas); `pode()` nunca passa do Speech
para ela, nem com ajuste do Admin (o banco recusa o ajuste). Carteiras do filtro: `carteiras_speech()` (só id, código e
nome; a tabela `credores` é da Cobrança). Site: `perfilSoSpeech`/`soSpeech` (`lib/perfis-info.ts`,
`use-areas-liberadas.ts`): menu só com o Speech, rota fora dele (menos `/conta`) volta para `/speech-analytics`, as
Gravações ficam dentro do Speech (contrato `speech_analytics`). Teste: `supabase/testes/testar_perfil_qualidade.py`
(varre toda tabela/view com `empresa_id` e toda RPC que recebe a empresa). Tabela ou RPC nova do Speech que a Qualidade
deve ler: use `minhas_empresas_speech()` ou `cliente_pode(empresa, <perm do Speech>)`. Se o SQL 60 rodar de novo, rode o 89.

**SQL 90 (Roleplay de treinamento, PR 2; SPEC aprovada pelo dono com os padrões recomendados): o banco do treino.** Só
banco (telas nos próximos PRs). Tabelas `treino_*` (equipes, cenários, atribuições e pessoas da atribuição, links e
acessos, sessões, transcrições, feedback ponto a ponto, feedback 1:1, revisões, discordâncias, sugestões, uso do mês),
todas com RLS por `cliente_pode(empresa, 'treinar_operadores')` (cenários também com `editar_cenarios_treino`; os 10
Padrão MotorCX, `empresa_id` nulo, só leitura). Permissões novas no catálogo e em `permissoes_speech()`/
`permissoes_qualidade()`: Admin e Qualidade sim, os outros perfis não. Operador sem login: `voz_operadores` ganha
`equipe_id` e `so_treino` (sem `operador_ref` só se `so_treino`); link pessoal com só o sha-256 do token (o site não lê
o hash), validade = maior prazo + 1 dia, um ativo por pessoa; **anon só chama** `treino_meus`, `treino_iniciar`,
`treino_resultado`, `treino_sair` e `treino_discordar` com o token (só os treinos daquele operador; módulo
`speech_analytics` desligado = "treinos indisponíveis"). Sessão: em_andamento → avaliada / abandonada / falhou; **só a
avaliada conta tentativa**; o resultado vem do serviço de treino por `registrar_sessao_treino` (service_role). Nota de
treino **nunca** vai para `voz_avaliacoes`/`voz_qualidade_dia`; áudio nunca é guardado; transcrição e feedback apagados em
90 dias por `apagar_voz_expirada()` (teste da Qualidade, 1 dia). Cobrança: `ia_treino_voz` (minuto) e `ia_treino_texto`
(sessão), franquia mensal (`franquia_padrao` 1.000 e 300, ou `precos_empresa.franquia`); custo em `consumo_ia`, na fatura
só o excedente; voz acabou = voz bloqueia, texto segue, aviso a 80% e 100%. Teste: `supabase/testes/testar_treino.py`.
Se o SQL 89 rodar de novo, rode o 90 depois.

**SQL 92 (pedido do dono: "Os preços precisam ser todos editáveis, você pode deixar pré-preenchido"): preços
editáveis.** Só acrescenta funções (nenhuma recriada). Onde se edita cada coisa:
- **Tabela/mínimo:** Mensageria em Console › Produtos (`salvar_produto`); Score e, novo, Motor (Orquestração, Jornada)
  e Agente de voz fora da IA (plataforma, gestão de tronco) também em Produtos (`salvar_preco_score`,
  `salvar_preco_padrao`; `editar_produtos`, mínimo opcional); itens de IA em Console › Margem › IA, só o Master
  (`salvar_preco_tabela_ia`, nunca abaixo do mínimo da IA).
- **Franquia padrão:** só nos itens de `itens_com_franquia()` (`ia_creditos`, `ia_treino_voz`, `ia_treino_texto`), só o
  Master, na gaveta de Margem › IA (`salvar_franquia_padrao`; o gatilho `guardar_franquia_padrao` barra gravação direta
  de quem não é Master).
- **Preço por empresa:** Empresa › Contratação, cartão Preços (`editar_precos`, vigência próximo ciclo/este ciclo com
  motivo): Motor e, novo, os grupos Agente de voz e Speech Analytics (módulo ligado). Itens com franquia gravam por
  `salvar_preco_franquia` (= `salvar_preco_vigencia` + a franquia da empresa na vigência; vazio = mantém/herda/padrão;
  a franquia dos Créditos de IA da empresa continua só com o Master, também em Margem › IA › Créditos). Mensageria e
  Score nas seções deles.
- **Pré-preenchido:** sem preço da empresa, o campo abre com o preço de tabela; a franquia, com a que vale.
Item novo com franquia: entra em `itens_com_franquia()` e em `site/src/lib/precos-itens.ts` (o teste confere a paridade).
Teste: `supabase/testes/testar_precos_editaveis.py`.

**SQL 93 (Robôs contratados, PR 1; SPEC aprovada pelo dono com os padrões recomendados): licenças do Agente de voz no
banco.** 1 robô = 1 conversa ao mesmo tempo com a IA (não é linha nem canal). Só banco: a fatura, a divisão da
concorrência (`divisao_concorrencia_voz()`) e o motor ainda não leem. `voz_licencas`: uma linha por vigência, **só se
acrescenta** (gatilho barra update/delete, até do servidor; a exclusão da empresa apaga em cascata); vale a última com
`vigente_desde <= hoje_sp()` (America/Sao_Paulo; no mesmo dia, a de maior id). Escrita só por `salvar_licencas_voz`:
robôs, fidelidade e franquia com `editar_contratacao`; preço novo também com `editar_precos`; abaixo do mínimo do catálogo
com `preco_abaixo_minimo` (ou Master) e motivo; guarda da IA = preço por robô ≥ `preco_minimo_licenca_voz(franquia)`
(franquia × custo do `voz_minuto_ia`, nem o Master passa). Vazio = pré-preenchido (o que vale; sem licença, a tabela e a
franquia padrão de 4.000 min). Aumento vale hoje ou no próximo ciclo; redução (robôs, franquia, transcrição) só no
próximo ciclo e nunca abaixo do mínimo da fidelidade antes do fim (fidelidade 0/6/12/24 meses, só mantém ou estende).
Overbooking (Σ robôs > `voz_contrato.concorrencia_contratada` numa mudança que aumenta) exige confirmação e avisa a
equipe (`/console/voz`). O preço vai também para `precos_empresa` (item `voz_licenca_robo`, eh_ia: flat = por robô,
mensalidade = valor fechado, franquia = a da licença) e **só pela licença** (gatilho `guardar_preco_licenca_voz`; o
cartão Preços da Contratação não mostra o robô, `ITENS_SO_LICENCA`). O robô entra em `itens_com_franquia()` (franquia
padrão com o Master em Margem › IA). Leitura: `voz_licencas` (sem motivo/autor) e `voz_licencas_cliente` para equipe com
`editar_contratacao`/`ver_faturamento` e cliente com `ve_faturamento`; `voz_licenca_vigente` (robôs, sem preço) para
quem é da empresa e o servidor; `licencas_voz(empresa)`: histórico da equipe (quem, de → para, situação, motivo).
Recriadas inteiras: `itens_com_franquia`, `custo_ia_referencia`, `guardar_preco_empresa_ia`, `ia_precos_abaixo_minimo`
(se o SQL 61 ou o 92 rodarem de novo, rode o 93 depois). Teste: `supabase/testes/testar_licencas_voz.py`.

**SQL 98 (Robôs contratados, PR 2): licenças na fatura.** `previa_fatura` (e por ela rascunhos, `fechar_fatura` e a
estimativa) lê o item `voz_licenca_robo` de `voz_licencas` (dia exato), **nunca** do preço que o SQL 93 grava em
`precos_empresa` (aquele vale o mês inteiro). Ciclo cheio = a licença do 1º dia do ciclo (`ciclo_de`; por robô: robôs ×
preço; valor fechado: o total). Mudança no meio do ciclo (aumento "agora", troca de preço, contrato que começa no meio):
linha `voz_licenca_robo_ajuste[_n]` = (total novo − anterior) × dias restantes ÷ dias do ciclo, contando o dia da
mudança (preço menor "agora" = crédito); no mesmo dia vale a última gravação. Com licença no ciclo (robôs > 0): franquia
do `voz_minuto_ia` = Σ robôs × `franquia_min_robo` pelos dias de cada vigência (linha `voz_minuto_ia_franquia`, sempre) e
excedente = minutos de IA + de pico − franquia, pelo preço da empresa, sem o mínimo mensal; `voz_plataforma` zerada
("incluída nos robôs"), `voz_transcricao` zerada se `transcricao_inclusa`, `voz_minuto_ia_pico` não se cobra;
`gestao_tronco_sip`, `ia_speech_analytics` e telefonia (fora) iguais. Pico desligado para quem tem licença vigente hoje
com robôs > 0: `divisao_concorrencia_voz()` (pico 1, teto = limite) e a view `voz_vm.config` (a VM lê o pico dali; o
motor não muda; o `voz_config.pico_multiplo` guardado fica). Funções novas (só servidor): `licenca_voz_ciclo`,
`segmentos_licenca_voz`, `linhas_fatura_licenca_voz`, `linhas_fatura_minuto_ia_voz`. **Recriadas inteiras:**
`previa_fatura`, `divisao_concorrencia_voz` e `voz_vm.config` — se o SQL 56, 57, 69 ou 78 (ou as migrações antigas de
fatura: `faturamento`, `precos_produtos`, `contratacao_ciclo`, `ciclo_pagamento`) rodarem de novo, rode o 98 depois.
Teste: `supabase/testes/testar_licencas_fatura.py`.

**Site · Contratação › Agente de voz › Robôs contratados (PR 3 do plano, sem SQL).** Seção em Empresa › Contratação
(`robos-contratados.tsx`: resumo com KPIs, limite real, mudança agendada e a prévia real do ciclo) e as telas
`/empresa/contratacao/robos` (editar: quantidade, por robô ou valor fechado, agora com pro rata ou próximo ciclo,
fidelidade, franquia, transcrição, motivo, limite real, overbooking com confirmação, revisão → `salvar_licencas_voz`) e
`/empresa/contratacao/robos/historico` (`licencas_voz`); as duas voltam para a Contratação (`rota-pai.ts`). As contas da
prévia simulada ficam em `site/src/lib/licencas-voz.ts`, iguais às do SQL 98 (o teste usa os mesmos números). Avisos:
mudança agendada continua valendo depois de um aumento "agora"; preço trocado "agora" é cobrado pelos dias (crédito se
menor); sem a linha `voz_minuto_ia_franquia` na prévia, a tela avisa que o SQL 98 falta. `ITENS_FATURA_VOZ` ganha
`voz_licenca_robo` e `ehItemFaturaVoz` cobre ajustes e franquia (`faturamento-voz.tsx`).

**SQL 101 (Robôs contratados, PR 4): divisão do teto global pelas licenças.** `divisao_concorrencia_voz()` (e por ela
`voz_divisao_concorrencia`, `voz_vm.divisao()`/`voz_vm.divisao_concorrencia`, a estimativa do lote e o motor/VM):
demanda = min(robôs vigentes hoje, canais dos troncos ativos) para quem tem licença com robôs > 0; cabe no teto → limite =
demanda; overbooking → floor(teto × demanda ÷ Σ demanda) com a sobra para as maiores frações (empate: mais demanda,
menor id), nunca acima da demanda. Quem não tem licença (ou tem 0 robôs, ou só agendada) divide **só a sobra** pelos
canais, com a regra antiga. Colunas novas no fim: `licencas` (nulo = sem licença) e `motivo` (`licencas` | `tronco` |
`teto` | `legado`); licença sem tronco ativo aparece com 0 canais e motivo `tronco`; `teto` = limite para quem tem
licença (pico desligado). O cliente não vê o teto global: `contratado` e `cota` vêm nulos fora da equipe/servidor/VM (o
motivo `teto` é "limite temporário da plataforma" para ele). O retorno mudou: drop cascade e recriar a função, as duas
views e `voz_vm.divisao()` com os grants; o motor lê só `empresa_id` e `limite` (sem mudança). Os SQL 56, 57 e 98
conferem a assinatura antes de recriar (56/57 voltam às sete colunas; o 98 pula a divisão se já tem `motivo`): se
rodarem de novo, rode o 101 depois. `definir_concorrencia_contratada` (mesma assinatura) avisa a equipe (sino,
`/console/voz`) quando diminui o teto para baixo dos robôs vendidos; não bloqueia. Teste:
`supabase/testes/testar_licencas_divisao.py` (cenários isolados numa transação desfeita).

**Site · Console › Agente virtual › Todas as empresas: robôs vendidos × teto (PR 5, sem SQL).** O cartão
"Concorrência contratada" virou "Robôs vendidos × teto contratado" (`console-voz-robos.tsx`): KPIs (teto, vendidos com
% do teto, usáveis = Σ min(licenças, canais), sobra para quem não tem licença), barra empilhada das licenças com o marco
do teto, alerta de overbooking (ou "quase no teto" a partir de 90%), teto editável (abaixo do vendido pede confirmação) e
a tabela por empresa com o "por quê" (`motivo` do SQL 101). Contas e frases em `site/src/lib/robos-voz.ts`
(`porQueCliente` nunca cita o teto global). Sem o SQL 101 no banco, o cartão avisa. A configuração da empresa mostra o
pico como "Desligado (robôs contratados)" para quem tem licença.

**SQL 102 + VM (Robôs contratados, PR 6): uso dos robôs.** `voz_robos_agora` (uma linha por empresa: `em_uso` = robôs
ocupados = conversas + reservas, `conversas`, `linhas` no ar, `aguardando` = números do dia que esperam na lista e não
estão discando, `limite` = teto aplicado agora pela VM, `no_limite`, `atualizado_em`; mais velho que 60 s = "sem leitura
agora", nunca zero) e `voz_robos_dia` (pico do dia em America/Sao_Paulo, `pico_em`, `segundos_no_limite`; 400 dias). Só
contagens. Grava só `registrar_uso_robos_voz(linhas)` (servidor ou VM; no acesso próprio, `voz_vm.registrar_uso_robos`):
o Plantão (`voz/orquestrador/principal.py › registrar_uso_robos`) manda a cada 15 s as empresas desta VM, com o pico da
janela vindo do agendador (`Agendador.foto_robos`: maior `ocupadas` desde a foto anterior) e os segundos no limite entre
duas fotos (até 60). Banco sem o SQL 102: a VM avisa no máximo 1 vez por hora e segue discando. Leitura: quem é da
empresa (`minhas_empresas()`) e a equipe com `cuida_voz`. Testes: `supabase/testes/testar_robos_uso.py` e
`tests/test_voz_robos_uso.py`.

**Site · Agente Voz/CX › Discagem: "Seu contrato" (Robôs contratados, PR 7, sem SQL).** No topo da Discagem
(`components/discagem/robos-contrato.tsx`), da empresa: contratados (`voz_licenca_vigente`, sem preço), disponíveis agora
(limite do SQL 101, nunca acima das licenças), em uso agora (`voz_robos_agora`; leitura mais velha que 60 s = "sem leitura
agora", nunca zero) e pico de hoje (`voz_robos_dia`, com a hora e o tempo no limite), barra de uso, o porquê quando fica
abaixo do contrato (`porQueCliente`: tronco ou "limite temporário da plataforma"; nunca o teto global), "O que acontece
quando todos os robôs estão ocupados" (ninguém cai; o número espera na lista) e "Pedir mais robôs" →
`/suporte/novo?assunto=robos&robos=N` (assunto, motivo e descrição pré-preenchidos; o Voltar dessa tela leva à Discagem:
`rotaPai` recebe a query em `busca`). Sem licença e com voz: cartão do modelo antigo com "Pedir robôs"; sem voz: nada.
Atualiza a cada 15 s. O Console (PR 5) ganha a coluna "Em uso · pico hoje".

**Agente de voz · ritmo da discagem: medir certo (Power e Preditivo V1, SQL 106).** `transferencia_sem_operador` é
desfecho próprio (conversou, pediu humano, a fila do cliente não atendeu e o agente não pôde voltar): NÃO é abandono do
discador (fora do freio e da meta; a fila humana cheia não freia a IA), não é curta por si (só pelos 6 s) e na
Renitência continua a linha "abandonada" (`situacao_voz`/`situacao_de`). O freio de abandono do agendador usa só os
últimos 30 min da empresa (`JanelaTaxa`; solta sozinho quando a janela anda), não o acumulado desde que a VM subiu.
`voz/orquestrador/medidor.py` conta, por empresa × carteira × janela de 5 min (fim da tentativa, horário de Brasília):
discadas, atendidas por pessoa, abandonos, transferências sem operador, curtas (a regra do motor, abandono sempre
conta) e o mesmo por tronco; o Plantão manda as janelas fechadas a cada minuto (`registrar_ritmo_voz`; acesso próprio
`voz_vm.registrar_ritmo`) com o modo, a razão e os robôs; banco fora = até 2.000 linhas esperam e 1 aviso por hora.
`voz_ritmo_amostras` (35 dias; a mesma janela soma) e `ritmo_voz_hoje(empresa, credor)` (totais e taxas do dia, última
amostra, janelas de 30 min, por tronco com a bina mascarada, abandono de 30 dias) para as telas; leitura de quem é da
empresa ou da equipe que cuida da voz. Testes: `tests/test_voz_ritmo.py` e `supabase/testes/testar_ritmo_voz.py`.

**Agente de voz · linhas e robôs separados com razão > 1 (Power e Preditivo V2, sem SQL).** Base do PR 212 (dois
contadores, reserva antes de discar, `no_pico` quando a conversa começa). Com a razão > 1 (carteira em Power/Preditivo, a
partir do V4), as linhas a mais saem SEM reserva e reservam o robô quando a pessoa ATENDE, antes do AMD
(`Agendador.reservar`; máquina devolve na hora); sem robô livre no atendimento, o AMD ainda decide e, se for pessoa, é o
abandono com mensagem (`abandono_sem_robo`). As sessões livres do provedor na VM limitam as linhas a mais
(`vaga_empresa(livres_max=…)`) e a reserva na originação só acontece com sessão do provedor (`ocupar(pode_reservar)`).
Linha tocando nunca ocupa robô. Com a razão 1,0 (padrão) nada muda.

**Agente de voz · ritmo por carteira (Power e Preditivo V3, SQL 107).** `credores.discagem › ritmo` =
`{modo: power|preditivo, razao 1–3 (Power), meta_abandono 0,5–3 % e razao_max 1–3 (Preditivo)}`; padrão **Power 1,0**
(o de hoje; Power 1,0 = Progressivo, ninguém atende sem robô). Teto de abandono fixo em 3 % (`DG.TETO_ABANDONO`, ninguém
sobe) e razão máxima de 2,0 na primeira semana do Preditivo (`RAZAO_MAX_1A_SEMANA`). Mesmo histórico de versões,
validação e auditoria da Discagem (`salvar_discagem`, `editar_credores`): o SQL 107 só recria `discagem_regras()` e
`discagem_padrao()` (gerados do motor; `tests/test_resubmit.py` confere). A VM lê por `regras_discagem_voz` ao carregar o
lote e relê a cada minuto (`Plantao.atualizar_ritmos`; banco fora = o de antes continua) em `Lote.ritmo`
(`DG.ritmo_da_carteira`: inválido = padrão).

**Agente de voz · Power e abandono digno (Power e Preditivo V4, SQL 108).** A VM aplica a razão da carteira
(`Lote.controle`, `voz/orquestrador/ritmo.py` › `RitmoCarteira`): Power = `ritmo.razao` (1,0 a 3,0); Preditivo, até o
V5, disca em aquecimento (1,0). Com razão > 1 nenhuma linha reserva robô ao originar: todas reservam quando atendem
(um robô preso a uma linha que só toca não serve a quem atendeu ao lado); com 1,0, cada linha sai com o seu. Teto de abandono da carteira: acima de 3 % (`DG.TETO_ABANDONO`) nos últimos 30 min com
50+ atendidas por pessoa, razão 1,0 até o fim do dia (estado `freado`, alerta). Quem atende sem robô ouve na hora a
mensagem neutra `sound:motorcx/sem-robo` (o "Alô fake" saiu: `voz_config.alo_fake*` ficou sem efeito) e **não recebe
outra ligação no dia** (`lote.ABANDONO_DISCADOR`: finaliza o cliente mesmo com a regra por sinalização e sai dos
reabríveis do "Reenviar agora"). Ao carregar o lote, `abandonos_recentes_voz` (só VM/servidor; id_cliente e contagens):
2 abandonos em 7 dias = 3 dias sem voz desde o último; 1 = a próxima ligação só sai com robô reservado
(`ItemLote.reservar`; `Lote.proximo(reservavel)`). As amostras ganham `razao_config` e `estado`
(normal|aquecendo|reduzido|freado|parado) e `ritmo_voz_hoje › ultima` os devolve.

**Agente de voz · freios de chamadas curtas no ritmo (Power e Preditivo V6, SQL 109; Despacho Anatel 100/2026).** A VM
mede em tempo real as curtas do dia por linha (tronco/bina) e no total da empresa (`voz/orquestrador/curtas.py`; a regra
do motor, abandono conta sempre) e freia bem antes do bloqueio da operadora (85 % com 1.000/linha ou 10.000/total): de
70 % a 80 % a razão cai linearmente até 1,0 (com 100+ ligações no dia na linha ou no total; estado `reduzido`); 80 % com
800 ligações = a linha para no dia (não disca nem gasta CPS; volta amanhã); 80 % com 8.000 = a empresa para no dia
(estado `parado`). Nunca troca a bina nem desvia para contornar. A cada 5 min o Plantão junta o que o banco já tem do
dia (`curtas_hoje_voz`, das amostras do SQL 106; VM reiniciada não começa do zero; fica o maior, nunca soma duas vezes)
e a liberação do Admin (`liberar_curtas_voz(empresa, motivo)`: só o Admin da empresa ou da equipe, motivo de 10 a 300
caracteres sem dado pessoal, 1 por dia, auditada em `voz_curtas_liberacoes`): os volumes de parada sobem para 950/linha e
9.500/total só naquele dia; a redução continua. **Vai para produção junto ou antes do Preditivo (V5).**

**Agente de voz · Preditivo (Power e Preditivo V5, SQL 110).** `RitmoCarteira` (`voz/orquestrador/ritmo.py`): razão =
fator ÷ p, de 1,0 até a razão máxima da carteira (2,0 na primeira semana em Preditivo). p = atendidas por pessoa ÷
discadas por janela de 30 min do dia com encolhimento (k = 200) para a base (a janela anterior do dia com 30+ atendidas;
senão a carteira em 7 dias; senão a empresa; senão 0,12); sem o "× 0,8" do PREDITIVO.md, porque p menor disca mais.
Fator começa em 0,8 (0,3–1,0), revisto a cada 5 min com 50+ atendidas nos últimos 30 min: acima do teto (3 %) × 0,5
na hora (estado freado) e, 10 min acima, Power 1,0 até o fim do dia; acima da meta −0,10; abaixo de meta ÷ 2 +0,05.
Aquecimento: Power 1,0 até 200 atendidas por pessoa da carteira em 7 dias (com as de hoje); razão até 1,5 nos primeiros
15 min do lote. Robôs que vão liberar até a linha nova atender (conversa já passou de conversa média − T; T = toque
médio + AMD) contam como livres (`Orquestrador._liberando`, `vaga_empresa(livres_extra)`). `historico_ritmo_voz` (só
VM/servidor; das amostras do SQL 106) a cada 30 min e ao carregar lote. Simulação de discagem com o agendador e o
controlador de verdade em `tests/sim_preditivo.py` (3 cenários do PREDITIVO.md com abandono ≤ 1,5 %; ~2× as conversas
do Power 1,0).

**Site · Agente Voz/CX › Discagem › Ritmo e "Robôs e o Preditivo" (Power e Preditivo V7a, sem SQL).** Aba **Ritmo**
(`components/discagem/ritmo.tsx`, primeira das abas): hoje na carteira (`ritmo_voz_hoje` a cada 15 s: razão agora,
abandono com meta e teto, atendimento por pessoa, curtas, frase de estado), "Como o MotorCX disca" (Power com números por
robô livre 1,0–3,0, 1,0 = progressivo; Preditivo com meta 0,5–3 % e razão máxima 1,5/2,0/2,5/3,0), "Quando alguém atende
e não há robô" (a mensagem neutra e as regras fixas), Freios (teto 3 %, curtas) e a gaveta "Qual escolher?". Edita
`draft.ritmo`, salvo com o resto da Discagem (`lib/discagem.ts › computeDiff` grava só o que difere de Power 1,0, via
`lib/ritmo.ts › ritmoSaida`; o "Salvar como vN" e o histórico ganham "Ritmo › …"). Página `/voz/discagem/robos`
(`robos-preditivo.tsx`; Voltar → Discagem; links no cartão do contrato e na aba): licença = conversas, não linhas;
exemplo ilustrativo no contrato da empresa (Power 1,0 / 2,0 / Preditivo) e o aviso "canais ≈ robôs × razão" quando o
tronco segura. Testes: `site/src/lib/ritmo.test.tsx`.

**Site · Agente Voz/CX › Ligações (faixa ao vivo) e Visão geral (Power e Preditivo V7b, sem SQL).** Em Ligações,
`components/voz/faixa-ritmo.tsx` › "Ritmo agora" da carteira do topo (ou da empresa), `ritmo_voz_hoje` a cada 15 s: modo
e razão, robôs (conversando, reservados, linhas no ar), abandono (meta e teto), curtas, atendimento por pessoa,
transferência sem operador separada, abandono em 30 dias, a frase de estado e, recolhidos, o dia por meia hora e por
linha (bina mascarada; "Parada hoje" pela mesma regra da VM). Linha parada: o Admin (perfil admin) vê "Liberar até
950/linha e 9.500/total hoje" (motivo; `liberar_curtas_voz`, SQL 109). Visão geral: "Ligações hoje" ("Preditivo ·
abandono 0,8% · curtas 76%") e, com freio, "Com problema: …". Testes: `site/src/lib/ritmo-ao-vivo.test.tsx`.

**Agente de voz · perna humana (Power e Preditivo V8, SQL 111).** A IA atende primeiro; o MotorCX não disca prevendo
os operadores do cliente. `voz_transferencias.simultaneas` ("Operadores para transferência ao mesmo tempo", 1–500,
padrão 5; Console › Agente virtual › transferência, `definir_operadores_transferencia_voz`, só a equipe que cuida da
voz; no acesso próprio a VM lê `voz_vm.transferencias_operadores` (id, simultaneas) e junta em
`configuracao.juntar_operadores`: a view do SQL 57 não muda, para ele continuar reaplicável): a VM nunca tem mais transferências tocando ou
em ponte para o destino; passou, o agente continua e agenda o retorno (`retomar_sem_humano`). Fila humana cheia: mais de
10 % das transferências sem operador nos últimos 30 min (20+ na amostra; `nucleo.FILA_CHEIA_PCT`) = o agente oferece o
retorno antes de chamar a fila, com alerta, até a janela voltar (o que nem foi tentado não entra na taxa). Toda
transferência sem operador conta à parte nas amostras do ritmo (mesmo com o agente de volta) e nunca no abandono. Ligações
mostra "Fila humana cheia" acima de 10 % no dia.

**Site · Agente Voz/CX › Discagem com os padrões novos na tela (PR 8 do plano Canais/Agente Voz/CX, sem SQL).**
Chamadas curtas: no topo, os medidores de hoje **por linha (bina)** e **no total da empresa** (`discagem/curtas-hoje.tsx`,
`ritmo_voz_hoje(empresa)` sem carteira, a cada 15 s; limites da Anatel 1.000/10.000; "Linha parada hoje" e "A empresa
parou de ligar hoje" pela mesma regra da VM, 800/8.000 ou 950/9.500 liberado); "Ligação não completada" e "Abandono"
contam sempre (travados; `effectiveDiscagem` força `abandono_conta = true` e o próximo salvamento tira o "não" salvo).
Renitência: cartão **Padrões recomendados** (tabela D2 da revisão) com "Nesta carteira" e "Usar os padrões recomendados".
Ritmo: bloco **Posição do número** (D3: 2 telefones por dia, horizontal; "Usar o recomendado" e a gaveta do modo).
Os dois botões só mudam o rascunho (`site/src/lib/discagem-recomendado.ts`; fixa 2 tentativas por número e liga a regra
por sinalização): vale ao salvar como vN (`salvar_discagem`). O padrão MotorCX do motor e do banco **não** muda.
Horários (faixa vermelha ao desligar) já vinham do B2. Testes: `site/src/lib/discagem-recomendado.test.tsx`.

**SQL 116 (PR 9 do plano Canais/Agente Voz/CX): "Testar agora" do Agente de voz.** Na tela do canal Agente de voz
(MotorCX), "Testar agora" (`components/canais/testar-agora.tsx`, `editar_canais`) faz uma ligação de verdade para um
número de teste confirmado, com o fluxo em uso da carteira e a rota de hoje. **Nenhum número passa pelo banco nem pelo
site:** o número fica no cofre (`voz_numeros_teste` do SQL 114, Telefonia, em paralelo; lido por SQL dinâmico, então o
116 roda antes ou depois dele); `voz_testes_agora` guarda id, máscara e hash (o site não lê o hash; auditada).
`pedir_teste_agora_voz(credor, numero_teste)` confere: fora do Simulado, número guardado + confirmado + na lista
(`voz_config.numeros_teste_hash`), fluxo em uso, rota ativa sem pausa, empresa não parada pelas curtas, domingo nunca,
um de cada vez e 5 por dia (o cancelado não conta); parado 10 min (ligando 15) expira. A VM (Plantão, a cada 15 s,
empresas em teste ou real; `voz/orquestrador/testar_agora.py`) pega com a referência do segredo, lê o número no cofre,
confere hash, plano nacional, janela da UF do número (tabela da carteira + prévia) e curtas, e põe um lote de um item
(`Lote.teste_id`; chave própria, fora de voz_lotes/ondas/resubmits) no orquestrador: mesmo caminho do lote (robô
reservado, CPS, tronco isolado, linha parada, aviso de gravação, identidade antes da dívida). Conta em voz_chamadas (modo
da empresa) e nos medidores, mas não volta ao motor (`ao_teste` no núcleo). `concluir_teste_agora_voz` recebe só marcas
e contagens (tocou, atendeu, agente, gravada, aviso, identidade, transferiu, segundos, toque, SIP). Canais de mensagem:
"em breve". Testes: `supabase/testes/testar_testar_agora.py`, `tests/test_voz_testar_agora.py`,
`site/src/lib/testar-agora.test.tsx`.

**SQL 95 (PR8 do redesenho do fluxo; SPEC B1 e B2): "Se não entender" e "Se não ouvir nada" por etapa.** Nas etapas que
ouvem (`voz/fluxo_validador.OUVEM`: abertura, identidade, pergunta, intencao, oferta, retorno), params opcionais
`nao_entendi` e `silencio` = `{fala?, vezes 1..3?}` e a saída opcional `quando = "silencio"`. Silêncio e "não entendi"
contam à parte (`Sessao.tentativas` × `Sessao.silencios`). Sem nada configurado, o "não entendi" é o de antes (fala padrão
de cada tipo, `tentativas` padrão 2, saída de "não entendi"). Silêncio: a Montagem chama `Sessao.silencio()` depois de
`SILENCIO_S` (6 s) sem fala da pessoa contados de quando a fila de áudio do agente esvazia (`RelogioSilencio`); padrão 2
vezes ("Desculpe, não ouvi." + a fala da etapa), depois a saída "silencio" ou, sem ela, a de "não entendi"; na Abertura sem
saída própria encerra SEM recado e sem marcar terceiro; na IA conversa, "Você ainda está aí?" e depois atendente. As falas
novas entram em `textos_do_bloco` (= `fluxo_voz_aux_textos_bloco`): 500 caracteres, variáveis, senha e trava 1. Simulador e
casos de teste: a fala `[silêncio]` (`MARCA_SILENCIO`). Site: dois quadros editáveis no detalhe da etapa
(`QuadroRepeticao`), linha no Roteiro e atalho "[silêncio]" no teste. Se o SQL 58 rodar de novo, rode o 95 depois.

## Convenções
Python 3.11+, sem dependências no núcleo. Nomes de domínio em português.
Nenhum dado pessoal real no repositório: exemplos e testes usam IDs e CPFs fictícios.
Arquivos de entrada (separador `;`):
- clientes: `id_cliente;data_entrada;saldo;dias_atraso[;bloqueio][;id_contrato]`
- carteira: `id_cliente;contato;tipo[;origem;cpf;whatsapp_valido;atualizado_em]`
- parcelas: `id_cliente;id_acordo;parcela;vencimento;valor;pago_em`
- base bruta e ocorrência da empresa: layout em `empresas/<slug>.json` (exemplo:
  `empresas/exemplo.json`, arquivos fictícios em `exemplos/empresa/`)

Comandos:
- Rotina diária: `python rodar_dia.py --clientes exemplos/clientes.csv --carteira
  exemplos/carteira_contatos.csv --retornos exemplos/retornos --parcelas exemplos/parcelas.csv
  --data 2026-09-25`
- Relatório do comitê: `python relatorio.py --clientes … --carteira … --retornos … --parcelas …
  --estado estado --inicio 2026-09-01 --fim 2026-09-30`
- Operação simulada (gera também o relatório): `python exemplos/simular_operacao.py`
- Exemplos: `python exemplos/gerar_retornos.py` · Demo da certificação: `python demo.py`
- Testes: `python -m unittest`
