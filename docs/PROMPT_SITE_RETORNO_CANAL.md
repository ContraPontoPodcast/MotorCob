# Prompt do site — Retorno de canal (DLR, bounce, lido, clique) oxigenando os contatos

Antes, rode no Supabase: `supabase/migrations/20261022000001_retorno_canal.sql` (tipos de envio
`canal_*`, tabela `canal_codigos`, coluna `canais_empresa.regras_retorno`).

Cole no Hostinger Horizons:

---

O MotorCob passa a receber os **retornos dos canais**: arquivos dos fornecedores (SMS, RCS, WhatsApp,
e-mail, voz) que trazem **só o telefone/e-mail e o status** (DLR do SMS, entregue/lido/clique do RCS
e WhatsApp, hard e soft bounce do e-mail, número inexistente da voz). São **apartados do CPC**: falam
do número, não do cliente. O motor usa isso para **oxigenar os contatos**: número morto, em pausa ou
bloqueado sai do canal e o **próximo contato do cliente assume** (telefone ou e-mail).

## 1. Enviar arquivos — seção "Retorno dos canais"

Abaixo dos cards atuais, uma seção **Retorno dos canais** com 5 cards no mesmo estilo:
**Retorno SMS**, **Retorno RCS**, **Retorno WhatsApp**, **Retorno e-mail**, **Retorno voz**.
- `tipo` do envio: `canal_sms`, `canal_rcs`, `canal_whatsapp`, `canal_email`, `canal_voz` (mesmo fluxo de
  upload dos outros: Storage `entradas/<slug>/<tipo>/<data>/...`, linha em `envios` com o credor selecionado).
- Descrição de cada card: "Arquivo do fornecedor com o telefone (ou e-mail) e o status do envio. Não precisa
  do ID do cliente."
- Na lista de envios, o status `aguardando` mostra `relatorio.aguardando` (aponte as colunas em Configurações →
  Canais). `processado` mostra: linhas, aproveitadas, `por_marca` (chips), `status_para_marcar` (lista amarela
  "marque em Configurações → Canais") e, se `lote_travado`, um aviso vermelho: "Mais da metade voltou como
  inexistente — parece falha do fornecedor. Nenhum número foi descartado por este arquivo."

## 2. Credores → Configurações — aba "Canais"

Nova aba **Canais** (ao lado de Arquivos, Ocorrências, Calendário), com badge do total de pendências
(canais com arquivo sem colunas confirmadas + status com `mapeado = false`).

Para cada canal que já recebeu arquivo (`mapeamento_arquivos` com `tipo = 'canal_<canal>'` do credor), um card:

**a) Colunas** (como na aba Arquivos): selects com as colunas do último arquivo (`cabecalho`), pré-preenchidos
com `sugerido` (selo "sugerido pelo MotorCob"):
- **Telefone/e-mail** (obrigatório) → `colunas.contato`
- **Status** (obrigatório) → `colunas.status`
- **Data do evento** (opcional; sem ela vale a data do arquivo) → `colunas.data`
Botão **Confirmar colunas**: `update mapeamento_arquivos set colunas = {...}, confirmado = true,
atualizado_em = now()`. Selo "Aguardando mapeamento" quando `confirmado = false`.

**b) Status do fornecedor** (tabela `canal_codigos` do credor e do canal): uma linha por `codigo` com qtd,
primeira/última vez, a sugestão (`sugerido`) e 6 opções de marca (rádio, uma por linha):

| Marca | Rótulo | Ajuda |
|---|---|---|
| `inexistente` | Inexistente | DLR permanente, hard bounce, número não existe |
| `temporario` | Temporário | aparelho desligado, fora de área, caixa cheia (soft bounce) |
| `entregue` | Entregue | chegou: o contato existe |
| `lido` | Lido | leu / abriu |
| `clique` | Clique | clicou, respondeu, interagiu |
| `bloqueio` | Bloqueio | opt-out, bloqueio, descadastro |

Salvar: `update canal_codigos set marca = ..., mapeado = true, atualizado_em = now()`. Botão **Aceitar as
sugestões** (marca = sugerido em todos os não mapeados que têm sugestão). Status novo aparece com selo **NOVO**.
Texto do topo: "Marque uma vez; os próximos arquivos entram sozinhos. Linhas com status sem marca esperam."

**Copiar de outro credor** (botão já existente) passa a copiar também `mapeamento_arquivos` dos tipos `canal_*`
e `canal_codigos`.

## 3. Página Canais — "Regras de retorno" em cada canal

Em cada canal da página Canais (SMS, RCS, WhatsApp, E-mail; a voz usa a linha do Discador), um bloco recolhível
**Regras de retorno** que edita `canais_empresa.regras_retorno` (jsonb). Mostre o padrão quando estiver vazio:

| Campo | Rótulo | Padrão |
|---|---|---|
| `temporarios_pausa` | Falhas temporárias seguidas para pausar (0 = nunca) | 3 (voz: 0) |
| `dias_pausa` | Dias de pausa | 30 |
| `inexistente` | Quando vier "inexistente" | SMS, e-mail, voz: `bloquear` · RCS, WhatsApp: `retestar` |
| `dias_rever` | Retestar depois de (dias) — só em "retestar" | 60 |
| `limite_lote` | Trava de lote: % de inexistente que indica falha do fornecedor | 50% (salve 0.5) |

Opções de `inexistente`: **Tirar do canal** (`bloquear`), **Tirar e retestar depois** (`retestar`),
**Não usar** (`ignorar`). Texto de ajuda: "No SMS, 'inexistente' tira o número do SMS e do RCS; voz e WhatsApp
continuam. No e-mail, tira o e-mail. Na voz, tira o número de todos os canais de telefone. Qualquer entrega,
leitura ou clique depois desfaz a pausa e o inexistente. Bloqueio nunca é desfeito por entrega."
Botão **Restaurar padrão** (grava `null`).

## 4. Saúde dos canais (Lista do dia e Início)

A rodada grava em `execucoes.resumo.retorno_canal` (última execução do credor):
`{resumo: {canal: {inexistente, temporario, entregue, lido, clique, bloqueio, contatos_inexistentes,
contatos_em_pausa, contatos_bloqueados, contatos_ativos}}, oxigenados: {canal: n}, contatos_fora: {canal: n},
economia_por_rodada: R$, higienizacao: n}` (pode vir `null` se o credor não tem retorno de canal).

- **Lista do dia**: card **Saúde dos contatos** acima das estratégias: por canal, "X contatos fora do canal"
  e "Y clientes oxigenados hoje" (saíram pelo próximo contato). Texto: "Quando um número volta inexistente,
  em pausa ou bloqueado, o MotorCob passa para o próximo contato do cliente." Em **Arquivos complementares**,
  nova linha **Higienização de contatos** → baixa `saidas/<slug>/<data>/<codigo>/higienizacao.csv`
  (contato, canal, situação, desde, até, clientes, último positivo) — "devolva ao CRM/credor".
- **Início**: um mini-card **Retorno dos canais** com contatos fora e "economia estimada por rodada:
  R$ economia_por_rodada" (tooltip: "contatos fora × custo do canal na página Canais").
- No alerta da home, as mensagens `RETORNO DE CANAL`, `STATUS PARA MARCAR` e `LOTE SUSPEITO` já chegam prontas.

## 5. Geral
- Português do Brasil; números em formato brasileiro.
- Erros de consulta usam o módulo de detalhe de erro existente.
- Nenhum telefone/e-mail aparece nas telas (só no arquivo baixado de higienização).
