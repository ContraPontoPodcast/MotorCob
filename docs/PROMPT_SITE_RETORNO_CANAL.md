# Prompt do site — Retorno de canal: oxigenar os contatos, com regras por credor

Antes, rode no Supabase: `supabase/migrations/20261022000001_retorno_canal.sql` (tipos de envio `canal_*`,
tabela `canal_codigos`, coluna `credores.regras_retorno`).

Cole no Hostinger Horizons:

---

O MotorCob passa a receber os **retornos dos canais**: arquivos dos fornecedores (SMS, RCS, WhatsApp, e-mail,
voz) que trazem **só o telefone/e-mail e o status** do envio. São **apartados do CPC** (falam do número, não do
cliente). O motor usa isso para **oxigenar os contatos**: número/e-mail morto, suspenso, em pausa ou bloqueado
sai do canal e o **próximo contato do cliente assume**. As regras são **de cada credor** — o MotorCob só sugere.

## 1. Enviar arquivos — seção "Retorno dos canais" (já existe)

Cinco cards: Retorno SMS, RCS, WhatsApp, e-mail, voz (`tipo` = `canal_sms`, `canal_rcs`, `canal_whatsapp`,
`canal_email`, `canal_voz`, com o credor selecionado). Na lista de envios:
- `aguardando` → mostre `relatorio.aguardando` com link para **Credores → (credor) → Configurações → Canais**.
- `processado` → linhas, aproveitadas, `por_marca` em chips (use os **nomes do canal** da tabela da seção 2),
  `status_para_marcar` (amarelo, "marque na aba Canais") e, se `lote_travado`, aviso vermelho: "Mais da metade
  voltou como falha — parece problema do fornecedor. Nenhum número foi descartado por este arquivo."

## 2. Credores → (credor) → Configurações → aba **Canais** (tudo do retorno de canal fica aqui)

Nova aba **Canais** ao lado de Arquivos, Ocorrências e Calendário, com badge de pendências (canal com arquivo
sem colunas confirmadas + status do fornecedor ainda não marcados). No topo: "As regras abaixo são deste credor.
Os valores vêm sugeridos pelo MotorCob; ajuste se a política do credor for outra." e o botão **Copiar de outro
credor** (copia `credores.regras_retorno`, os `mapeamento_arquivos` dos tipos `canal_*` e os `canal_codigos`).

Um card por canal — **SMS, RCS, WhatsApp, E-mail, Voz** (abas internas ou acordeão). Cada card tem 3 partes:

### 2.1 Retornos esperados e regras de renitência (o coração do card)

Uma tabela com **o que esse canal devolve**, na língua do canal, e a **regra** de cada retorno, editável ali
mesmo. Grava em `credores.regras_retorno` (jsonb do credor) no formato `{<canal>: {campos}}` — canal = `sms`,
`rcs`, `whatsapp`, `email`, `voz`. Campo vazio = sugestão do MotorCob (mostre "Sugestão MotorCob: …" em cinza e
destaque em âmbar o que o credor mudou). Botão **Restaurar sugestão** por canal (remove a chave do canal).

**SMS**
| Retorno | O que é | Regra (sugestão) | Campos |
|---|---|---|---|
| Entregue | DELIVRD — o número está ativo | Zera as falhas e desfaz suspensão/pausa | — |
| Clique / resposta | clicou no link ou respondeu | Reforça o número; zera as falhas | — |
| **Não entregue (DLR)** | UNDELIV, REJECTD, número inválido | **Suspensão escalonada do número em tudo que vai para o celular** (SMS, RCS, WhatsApp e voz nesse número): 1ª vez 7 dias, 2ª 15, 3ª 30, 4ª 90, 5ª 120; depois reabre (nova falha = último degrau). Os outros contatos do cliente assumem. | `inexistente` (Suspensão escalonada · Tirar do SMS e RCS · Não usar) e `escalonamento` (chips de dias, até 10, "+ degrau") |
| Falha temporária | EXPIRED, desligado, fora de área | 3 seguidas → pausa de 30 dias no SMS | `temporarios_pausa` (0 = nunca), `dias_pausa` |
| Opt-out | SAIR / STOP | Nunca mais SMS para o número | — |

**RCS**
| Retorno | O que é | Regra (sugestão) | Campos |
|---|---|---|---|
| Entregue · Lido · Clique / interação | chegou, abriu, interagiu | Zera falhas; lido/clique reforçam o número | — |
| **Sem suporte a RCS** | aparelho/operadora não aceita RCS | Sai do RCS e segue por SMS, WhatsApp e/ou voz; **testa o RCS de novo em 60 dias** | `inexistente` (Tirar e testar de novo · Tirar de vez · Não usar), `dias_rever` |
| Falha temporária | não entregue agora, expirado | 3 seguidas → pausa de 30 dias no RCS | `temporarios_pausa`, `dias_pausa` |
| Opt-out / bloqueio | pediu para não receber | Nunca mais RCS | — |

**WhatsApp**
| Retorno | O que é | Regra (sugestão) | Campos |
|---|---|---|---|
| Entregue · Lido · Respondeu / clicou | dois tiques, azul, interação | Zera falhas; lido/resposta reforçam o número | — |
| **Sem conta no WhatsApp** | o número não tem WhatsApp | Sai do WhatsApp; **testa de novo em 15 dias** | `inexistente`, `dias_rever` |
| Falha temporária | falha de envio, expirado | 3 seguidas → pausa de 30 dias no WhatsApp | `temporarios_pausa`, `dias_pausa` |
| Bloqueou / denunciou | bloqueou o remetente | Nunca mais WhatsApp | — |

**E-mail**
| Retorno | O que é | Regra (sugestão) | Campos |
|---|---|---|---|
| Entregue · Aberto · Clique | aceito, abriu (sinal fraco), clicou | Zera falhas; clique reforça o e-mail | — |
| **Hard bounce** | e-mail ou domínio inexistente | Sai este e-mail; vai o próximo e-mail do cliente | `inexistente` (Tirar de vez · Tirar e testar de novo · Não usar), `dias_rever` |
| **Soft bounce** | caixa cheia, servidor fora | 3 seguidos → pausa de 30 dias | `temporarios_pausa`, `dias_pausa` |
| Descadastro / spam | pediu para sair, marcou spam | Nunca mais e-mail para este endereço | — |

**Voz**
| Retorno | O que é | Regra (sugestão) | Campos |
|---|---|---|---|
| Atendeu · Caixa postal | alguém atendeu; caixa postal = número existe | Zera as falhas (inclusive as do SMS) | — |
| **Número inexistente** | não existe, não completa | A telefonia pode falhar: sozinho **suspende só a voz** nesse número, na mesma escada (7/15/30/90/120). **Junção com o SMS**: as falhas da voz e do SMS somam; se o SMS também falhou, a suspensão vale para tudo do celular. | `inexistente` (Suspensão escalonada · Tirar de todos os canais de telefone · Não usar) e `escalonamento` |
| Não atende / ocupado / fora de área | tocou e ninguém atendeu | Sugestão: não pausa (a esteira já cuida das tentativas) | `temporarios_pausa` (0 = nunca), `dias_pausa` |
| Não ligar | pediu para não receber ligação | Nunca mais voz para o número | — |

Em cada card, embaixo, um campo avançado: **Trava de lote** — `limite_lote` ("se mais de X% de um arquivo vier
como falha permanente, é problema do fornecedor e nada é descartado"; sugestão 50%, salve 0.5).

Formato salvo (exemplo, só o que o credor mudou):
`{"sms": {"escalonamento": [3, 7, 15]}, "whatsapp": {"dias_rever": 30}, "voz": {"inexistente": "bloquear"}}`
Valores de `inexistente`: `escalonar` (SMS e voz), `bloquear` (tirar de vez), `retestar` (tirar e testar de
novo depois de `dias_rever`), `ignorar` (não usar).

### 2.2 Arquivo do fornecedor — colunas

Selects com as colunas do último arquivo (`mapeamento_arquivos` do credor, `tipo = 'canal_<canal>'`,
`cabecalho`), pré-preenchidos com `sugerido` (selo "sugerido pelo MotorCob"): **Telefone/e-mail** (obrigatório,
`colunas.contato`), **Status** (obrigatório, `colunas.status`), **Data do evento** (opcional, `colunas.data`;
sem ela vale a data do arquivo). **Confirmar colunas**: `update mapeamento_arquivos set colunas = {...},
confirmado = true, atualizado_em = now()`. Sem arquivo ainda: "Envie o primeiro arquivo em Enviar arquivos →
Retorno dos canais".

### 2.3 Status do fornecedor → retorno esperado

Tabela `canal_codigos` (do credor e do canal): uma linha por `codigo` (o texto que o fornecedor manda), com qtd,
primeira/última vez e um select **"é o retorno…"** com as opções **daquele canal** (as linhas da tabela 2.1 —
ex.: no SMS: Entregue, Clique / resposta, Não entregue (DLR), Falha temporária, Opt-out). Pré-selecione
`sugerido`. Salvar grava a marca interna correspondente:

| Canal | Opção → `marca` |
|---|---|
| SMS | Entregue → `entregue` · Clique / resposta → `clique` · Não entregue (DLR) → `inexistente` · Falha temporária → `temporario` · Opt-out → `bloqueio` |
| RCS | Entregue → `entregue` · Lido → `lido` · Clique / interação → `clique` · Sem suporte a RCS → `inexistente` · Falha temporária → `temporario` · Opt-out / bloqueio → `bloqueio` |
| WhatsApp | Entregue → `entregue` · Lido → `lido` · Respondeu / clicou → `clique` · Sem conta no WhatsApp → `inexistente` · Falha temporária → `temporario` · Bloqueou / denunciou → `bloqueio` |
| E-mail | Entregue → `entregue` · Aberto → `lido` · Clique → `clique` · Hard bounce → `inexistente` · Soft bounce → `temporario` · Descadastro / spam → `bloqueio` |
| Voz | Atendeu → `clique` · Caixa postal → `entregue` · Número inexistente → `inexistente` · Não atende / ocupado / fora de área → `temporario` · Não ligar → `bloqueio` |

`update canal_codigos set marca = ..., mapeado = true, atualizado_em = now()`. Botão **Aceitar as sugestões**.
Status novo com selo **NOVO**. Texto: "Marque uma vez; os próximos arquivos entram sozinhos. Linhas com status
sem marca esperam."

## 3. Página Canais (empresa)

Continua só com ligar/desligar, custo, horário e capacidade de cada canal. **Remova** o bloco "Regras de retorno"
desta página (as regras agora são do credor, seção 2.1); no lugar, um texto: "As regras de retorno de cada canal
(DLR, bounce, sem conta…) ficam em Credores → (credor) → Configurações → Canais."

## 4. Saúde dos contatos (Lista do dia e Início)

A rodada grava em `execucoes.resumo.retorno_canal` (última execução do credor; pode ser `null`):
`{resumo: {canal: {contagens por marca, contatos_suspensos, contatos_inexistentes, contatos_em_pausa,
contatos_bloqueados, contatos_ativos}}, oxigenados: {canal: n}, contatos_fora: {canal: n},
economia_por_rodada: R$, higienizacao: n}`.
- **Lista do dia**: card **Saúde dos contatos**: por canal, "X contatos fora do canal" e "Y clientes oxigenados
  hoje" ("saíram pelo próximo contato"). Em **Arquivos complementares**: **Higienização de contatos** → baixa
  `saidas/<slug>/<data>/<codigo>/higienizacao.csv` (contato, canal, situação, desde, até, clientes) — "devolva ao
  CRM/credor".
- **Início**: mini-card **Retorno dos canais**: contatos fora e "economia estimada por rodada: R$ …" (tooltip:
  contatos fora × custo do canal).
- Alertas da home `RETORNO DE CANAL`, `STATUS PARA MARCAR` e `LOTE SUSPEITO` já chegam prontos.

## 5. Geral
- Português do Brasil. Erros de consulta usam o módulo de detalhe de erro existente.
- Nenhum telefone/e-mail nas telas (só no arquivo de higienização baixado).
