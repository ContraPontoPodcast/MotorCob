# Prompt Horizons — Workspace 35: etapas, prospecção (leads) e Travas no MotorCli

Rode depois do SQL 26, do prompt 24 (telas do MotorCli) e do prompt 34 (componentes das etapas no MotorCob).
Protótipo: `07_workspace/etapas-prototipo.html` (botão MotorCli no topo). Nenhuma tabela nova.

```text
MotorCli › Jornada › Momentos da jornada: acrescente "Etapas da régua" com os MESMOS componentes das "Etapas da régua"
do MotorCob (lista com prioridade ▲▼, editor em 7 seções, Desenho da Esteira com raias e 💬, ciclo, orçamento por
canal, painel Travas). Grava em estrategias.definicao da estratégia da frente MotorCli, sem apagar
"momentos" nem "recencia_horas". Não altere o MotorCob nem crie tabelas, views ou políticas.

## 1. Diferenças em relação ao MotorCob
- Fases padrão na lista (selo "Padrão"): pre_vencimento=Pré-vencimento, boas_vindas=Boas-vindas,
  ativacao=Ativação, retencao=Retenção, reativacao=Reativação. Liga/desliga grava momentos.<m>.ativo.
- Quem entra — campos: e_cliente (sim | não), origem, base_legal, dias_atraso, momento (o momento do motor
  hoje), ativado (sim | não) e as colunas da carga de clientes e de leads.
- Como contar os dias — tipos: entrada (Dias desde que entrou na etapa), lead (Dias desde a entrada do lead),
  contratacao, vencimento (Dias até o vencimento; D-5 = -5), sem_atividade, coluna.
- Quando sai — eventos: convertido (Virou cliente: o id do lead apareceu na carga de clientes) e fim_janela.
  Destinos: padrao, sai, etapa:<id>.
- Orçamento: igual, sem os critérios de atraso; saldo_maior/saldo_menor viram "Limite disponível"
  (coluna limite_disponivel da carga); hot = "Já respondeu antes" (contato certificado).
- Travas próprias da etapa: só Intervalo entre ações (mín. 12 h) e Ações por dia.
- Modelos: Em branco · Prospecção · Aniversário de contrato · Upgrade de produto.

## 2. Modelo "Prospecção" (e aviso LGPD)
Ao escolher o modelo, preencha: nome "Prospecção", condições e_cliente = não e base_legal preenchido,
referencia {"tipo": "lead"}, de 0, ate 30, saidas {"convertido": "etapa:boas-vindas" se existir, senão
"padrao", "fim_janela": "sai"}. Em toda etapa cuja condição tenha e_cliente = não, mostre acima da seção 2
um bloco âmbar: "Prospecção fala com quem ainda não é cliente. Só entra lead com base legal registrada
(consentimento ou legítimo interesse) e a origem. Toda mensagem leva a saída (Responda SAIR); quem sai não
volta. Não Perturbe e bloqueio valem sempre. Lista comprada sem base legal não entra: o motor recusa." e a
caixa "A empresa confirma que os leads desta etapa têm base legal para contato." (obrigatória para salvar).

## 3. Enviar arquivos (/jornada/cargas): terceiro arquivo "Leads (prospecção)"
Mesmo upload de hoje, tipo 'leads' em envios (bucket entradas, credor_id da carteira). Botão "Baixar modelo":
  id_lead;data_entrada;origem;base_legal;telefone;email;whatsapp;bloqueio
Ajuda: "base_legal: consentimento ou legítimo interesse (obrigatório). Sem base legal, sem origem, sem data
ou sem contato, o lead é recusado e aparece no relatório do envio. Colunas a mais viram campos para as
condições. Quando o lead vira cliente, use o mesmo id em id_cliente na carga de clientes." Só a
carteira MotorCli aceita leads (no MotorCob o envio é recusado).

## 4. Travas (painel da estratégia MotorCli) → definicao.travas
- intervalo: Esperar [48] horas (mín. 12) · Pré-vencimento: Não espera | Respeita o intervalo
  → {"ligado", "horas", "cpc": "segue"|"respeita"} (aqui "cpc" vale para o pré-vencimento)
- horario: De/Até (entre 08:00 e 20:00) · Sábado: Normal | Até 14:00 | Não aciona → como no MotorCob
- domingo_feriado: Domingo: Não aciona | Normal · Feriados nacionais: Não aciona | Aciona
- limite_acoes: por dia / semana / mês → {"ligado", "dia", "semana", "mes"}
- limite_leads: Leads: até [2] ações por semana → {"ligado", "semana"}
Fixas (cadeado): Opt-out e descadastro · Lead sem base legal · Cliente em atraso (fica com a cobrança).

## 5. Início e Lista do dia da Jornada
- Início: depois dos 5 cards dos momentos, um card por etapa da empresa (jornada_resumo com momento
  'etapa-<id>'), com o nome da etapa e "N com ação hoje". Card "Leads": aceitos = execucoes.resumo.leads
  da última rodada; recusados = soma de envios.relatorio.rejeitados do último envio tipo 'leads', por motivo.
- Lista do dia: Momento mostra o nome da etapa para 'etapa-<id>'; Passo mostra D+3 ou C2-D3 (2º ciclo, dia 3).
- Motivos novos em "Quem ficou de fora hoje" (texto já vem do motor em jornada_resumo.motivo): "em uma etapa
  da empresa, sem passo hoje", "saiu da régua pela regra de uma etapa da empresa", "lead fora das condições
  das etapas de prospecção", "ficou fora do orçamento do canal na etapa (concorre de novo amanhã)",
  "atingiu o limite de ações por cliente (trava da estratégia)".

Confira em 1440 e 390 px, com uma empresa que tem as duas frentes: nenhuma tela mostra telefone, e-mail,
CPF ou nome do lead; só o ID.
```
