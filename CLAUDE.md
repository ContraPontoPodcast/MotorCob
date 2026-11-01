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
  slides diferentes; esta é a leitura adotada).
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
  memória e não vai para nenhuma saída.
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
  decide o desfecho: operador > transferência sem operador/falhou (= `abandonada`) > IA > rede; "não atende"
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
  atual na rotina seguinte. Regra inválida vira alerta, nunca derruba a rotina.
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
  layouts). Horário por UF/DDD vem DESLIGADO por padrão até o jurídico validar a prévia e o cliente poder
  ligar/editar na tela (`discagem.horarios.ativo`); ligado: (`Regua.janela_do_numero` = estratégia ∩ canal ∩ UF do DDD
  em hora local → Brasília ∩ 08:00–20:00, sem domingo/feriado; tabela do cliente, senão a PRÉVIA
  `regras/horarios_uf.json`, que não é orientação jurídica; número sem janela não sai na voz, o próximo
  assume, motivo na Lista do dia). Ligados por padrão: bloqueio de inexistente (layout com `inexistente_confirmado` só aceita
  esses códigos; o resto vira falha_rede), "não ligar" e o aviso de chamadas curtas. Desligados, com o valor
  recomendado: descanso por N "não atende" (pausa da voz no número via `retorno_canal`,
  `temporarios_janela_dias`), recusa (descanso da voz do cliente), promessa (voz suspensa até a data + 1)
  e o corte de curtas. Chamadas curtas (MP 1.396/2026; ≤ 6 s, caixa postal, não completada, abandono
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
- **Renitência por situação e Resubmit (SQL 65; protótipo aprovado em 01/11/2026):** chaves novas em
  `credores.discagem` (uma validação, um histórico, uma auditoria): `por_situacao` {maquina, nao_atendida, ocupado,
  caixa_postal, desligou_sem_conversar, atendeu_desligou: {intervalo_minutos, max_dia, conta_descanso}},
  `falhas_tecnicas` {falha_operadora, sem_credito (= 402), falha_rede, indisponivel, bloqueio_originacao,
  cancelada_discador, abandonada: {religar_minutos, aviso}}, `resubmit` {situação: {ativo, depois_minutos, max_dia,
  prioridade topo|normal|fim, ate, outro_numero}} e `chamadas_curtas.falha_conta`. **Sem as chaves, tudo como antes
  (paridade, `tests/test_resubmit.py`).** `DG.situacao_de`, `DG.regra_situacao`, `DG.resubmit_efetivo` (vale o MAIOR
  entre "depois de" e o intervalo; o máximo é cortado pelas tentativas por número, ou por cliente com outro número).
  `indisponivel` virou falha técnica (decisão do dono): fora da certificação e do descanso, ainda conta como tentativa.
  VM (`voz/orquestrador/lote.py`, `RegrasLote` via RPC `regras_discagem_voz`): com resubmit, o número só volta por
  uma Volta decidida no fim da tentativa; ordem = voltas topo > 1ªs tentativas (ordem do arquivo) > voltas normal >
  voltas fim (regra 5 do agendador mudou: topo fura as 1ªs). Cada decisão vai para `voz_resubmits` (só destino_hash);
  chamadas levam `passada`, `situacao_origem`, `resubmit_id`, `lote_id` e `destino_hash`. "Reenviar agora"
  (`pedir_reenvio_voz`, permissão `reenviar_lote_voz`, Admin e Operação) é pego pela VM (`pegar_reenvio_voz`) e passa
  pelas mesmas regras. À noite a VM agrega `voz_passadas_dia` (`agregar_passadas_voz`, contato = `e_cpc`, curtas do
  motor); o site lê `contato_por_passada` (menos de 30 chamadas = sem percentual). O site grava só por
  `salvar_discagem` (valida com `discagem_erros`, igual ao motor; versões em `regras_voz_versoes`; recusa se outra
  pessoa salvou antes). Padrão que o site mostra: `discagem_padrao()` = `DG.padrao_site()` (teste confere).
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
  `voz_config.speech_analytics` por empresa. Os dois acessos da VM (funções de `voz_vm`).
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
  Sem código de cliente, o CPF vira o ID. Grava config/entrada_automatica.json e põe o que
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
`site/LEIA.md`. CI: `.github/workflows/site.yml` (lint + typecheck + build).

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
