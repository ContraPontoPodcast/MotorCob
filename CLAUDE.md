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
identidade/CPC · discador CPC · SMS clique/resposta · e-mail clique · portal login pelo link.
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
- Receita prevista = acordos previstos × ticket médio do acordo × % de parcelas pagas; ROI
  ≥ 1,5x aprova · 1,0–1,5x aprova com plano · < 1,0x reprova. (Real x Previsto em Excel —
  próxima entrega.)
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
- `motor/certificacao.py`: score Beta por contato, status, hit rate, afinidade.
- `motor/taxonomia.py`: retorno bruto de cada canal → `Nivel` + pesos + restrições.
- `motor/ingestao.py` + `layouts/*.json`: retornos por layout de fornecedor, base de
  clientes (agrega contratos), carteira de contatos e parcelas.
- `motor/normalizacao.py`: ID, CPF, telefone e e-mail na forma canônica.
- `motor/rastreio.py` + `disparar.py`: link rastreável por ação e registro de ações.
- `motor/priorizacao.py` + `rodar.py`: diagnóstico da carteira por valor esperado (base
  para sugerir ao comitê mensal a ordem de rotação por eficiência; não comanda a fila).
- `rodar_dia.py`: **rotina diária** (estado em `estado/`, fila/enriquecimento em `saida/`).
- `exemplos/simular_operacao.py`: operação simulada dia a dia com verdade conhecida e
  auditoria das regras. `exemplos/gerar_retornos.py`: arquivos de exemplo.
- `db/schema.sql`: modelo alvo em Postgres. `tests/`: testes das regras e princípios.

## Status de certificação
CERTIFICADO (certificação + score ≥ 0,7) · PROVAVEL (≥ 0,6) · NAO_CONFIRMADO ·
CONTESTADO (< 0,2) · INVALIDO · DESCONHECIDO (sem evento).

## Roadmap
1. **Feito:** certificação, ingestão por layout, ID do cliente, link rastreável, TAG +
   trilha + réguas + acordos + fila do dia + enriquecimento.
2. **Próximo:** KPIs por safra/cluster (localização por canal, custo por CPC descoberto,
   migração de estados, tentativas até o contato, % acordo, regularização da quebra) e
   Real x Previsto em Excel para o comitê.
3. Acordo pelo operador ligado à ação de origem; webhook/API dos fornecedores.
4. Camada de agentes: Ingestão (quarentena → de-para), Analista, Estrategista, Validador.
5. Calibração com dados reais: pesos de evidência, limiares, prior por origem, taxas.

## Convenções
Python 3.11+, sem dependências no núcleo. Nomes de domínio em português.
Nenhum dado pessoal real no repositório: exemplos e testes usam IDs e CPFs fictícios.
Arquivos de entrada (separador `;`):
- clientes: `id_cliente;data_entrada;saldo;dias_atraso[;bloqueio][;id_contrato]`
- carteira: `id_cliente;contato;tipo[;origem;cpf;whatsapp_valido;atualizado_em]`
- parcelas: `id_cliente;id_acordo;parcela;vencimento;valor;pago_em`

Comandos:
- Rotina diária: `python rodar_dia.py --clientes exemplos/clientes.csv --carteira
  exemplos/carteira_contatos.csv --retornos exemplos/retornos --parcelas exemplos/parcelas.csv
  --data 2026-09-25`
- Operação simulada: `python exemplos/simular_operacao.py`
- Exemplos: `python exemplos/gerar_retornos.py` · Demo da certificação: `python demo.py`
- Testes: `python -m unittest`
