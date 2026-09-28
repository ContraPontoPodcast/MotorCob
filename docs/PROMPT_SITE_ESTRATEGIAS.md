# Prompt de ajuste do site: estratégias, canais e retorno do enriquecimento

Use **depois** do prompt `docs/PROMPT_SITE_MULTIEMPRESA.md`. Antes de colar, aplique no
Supabase a migração `supabase/migrations/20260929000001_estrategias.sql` (SQL Editor ›
New query › colar o conteúdo do arquivo, não o nome › Run).

---

```text
Ajuste o site MotorCob: páginas de Estratégias e Canais, estratégia no Cluster e um novo
tipo de envio. O banco já foi alterado — NÃO crie, altere ou apague tabelas, views,
buckets ou políticas. Mantenha todo o resto do site como está. Tudo filtrado pela
empresa selecionada (empresa_id), como nas outras páginas. Admin e planejamento editam;
os demais papéis só veem.

## Menu
Depois de "Clusters": "Estratégias" e "Canais".

## Enviar arquivos
Novo tipo, logo depois de "Ocorrências": enriquecimento → "Retorno do enriquecimento
(bureau)". Vários arquivos de uma vez. Caminho: {slug}/enriquecimento/{AAAA-MM-DD}/{timestamp}_{nome}.
Ajuda: "O arquivo que volta do bureau, do jeito que vem (um CPF por linha, telefones com
WhatsApp, RCS, score e Não Perturbe). O MotorCob junta os números novos e as marcas à base."
No relatório do envio mostre clientes_encontrados, sem_cliente, telefones_novos,
telefones_atualizados e emails_novos.

## Estratégias (/estrategias)
Tabela estrategias (id, empresa_id, nome, descricao, definicao jsonb, padrao boolean,
atualizado_em). Uma estratégia diz, fase por fase, quais canais acionar, em que dia, em
qual ordem e em quais contatos. Os clusters escolhem a estratégia.

Lista: cartões com nome, descrição, selo "Padrão da empresa" quando padrao = true, quantos
clusters usam (select count em clusters where estrategia_id = id), data da última
alteração, botões Editar, Duplicar (copia com nome "… (cópia)" e padrao = false) e Excluir
(avise: "Os clusters que usam esta estratégia passam a seguir a padrão da empresa").
Botão "Marcar como padrão": primeiro grava padrao = false na atual padrão e depois true
nesta (só pode existir uma). Texto no topo: "Cluster sem estratégia segue a padrão da
empresa; sem padrão, segue o playbook MotorCob. Mudanças valem a partir da rotina do dia
seguinte."

Editor (página própria /estrategias/{id}, com Salvar e Cancelar): nome, descrição e 5 abas,
uma por fase. O que o usuário deixar vazio numa fase não é gravado (a fase segue o
playbook) — mostre na aba "Seguindo o playbook MotorCob" e um botão "Personalizar esta fase".

Abas e o que gravar em definicao:
1. "Cliente novo" → definicao.localizacao = {passos, dias_sem_contato_para_ncp}
   Campo: "Vira Não CPC depois de N dias sem contato" (padrão 8).
2. "CPC (já teve contato)" → definicao.cpc = {ordem, junto, tentativas_por_canal}
   - "Ordem dos canais": lista ordenável (arrastar) de ações (ver Ação abaixo, sem o campo
     Modo). O cliente vai para o próximo canal quando esgota as tentativas no atual.
   - "Sempre junto": lista de ações que acompanham o canal da vez (ex.: e-mail).
   - "Tentativas por canal antes de trocar" (padrão 3).
3. "Não CPC (giro)" → definicao.giro = {passos, ciclo_dias, max_ciclos}
   Campos: "Duração do ciclo em dias" (padrão 8), "Ciclos antes de pedir novo
   enriquecimento" (padrão 3). Os dias dos passos são dias do ciclo (1 a duração).
4. "Preventivo" → definicao.preventivo = {passos}. Dias ANTES do vencimento: mostre
   "D-3", "D-1", "D0" (grave "3", "1", "0").
5. "Quebra" → definicao.quebra = {passos, dias_para_estoque}. Dias DEPOIS da quebra
   (D+1, D+3…). Campo: "Volta ao estoque depois de N dias sem pagamento" (padrão 6).

Passos (abas 1, 3, 4 e 5): linha do tempo de dias. Botão "+ dia" (número do dia). Cada
dia tem um BLEND: lista ordenada de ações. Grave passos como objeto {"1": [ação...],
"3": [...]} (chave = número do dia em texto).

Ação (um cartão por ação, com Subir/Descer/Remover):
- Canal (select com ícone): WhatsApp (whatsapp), RCS (rcs), Agente virtual (agente_voz),
  Discador (discador), SMS (sms), E-mail (email).
- Modo (select), com a explicação embaixo:
  sempre → "Sempre: vai se houver contato que passe no filtro"
  senao → "Senão: só se nada acima (desde o último 'Sempre') foi"
  junto → "Junto: vai junto com a ação de cima, se ela foi"
  reserva → "Reserva: se a de cima foi, só se ela não contatar no dia; se não foi, vai no lugar dela"
  A primeira ação do dia é sempre "Sempre" (não deixe escolher outro).
- Quais contatos (checkboxes e campos; tudo opcional; grave em ação.contatos):
  "Só com WhatsApp" (whatsapp: true), "Só com RCS" (rcs: true), "Só contato que pertence
  ao cliente" (pertence: true), "Fora do Não Perturbe" (sem_nao_perturbe: true),
  "Score do bureau mínimo" (score_bureau_min: número 1 a 5), "Certificação aceita"
  (status: multi-select de CERTIFICADO Certificado, PROVAVEL Provável, NAO_CONFIRMADO Não
  confirmado, DESCONHECIDO Sem histórico), "Origem" (origem: multi-select de cliente,
  bureau, enriquecimento).
- Quantos números (numeros): "Padrão do canal" (não grava) ou 1, 2, 3, "Todos" (grave 99).
Grave cada ação como {"canal": "...", "modo": "...", "contatos": {...}, "numeros": n}.

Prévia em frase, embaixo de cada dia, montada a partir das ações. Exemplo:
"D+1: WhatsApp (só com WhatsApp) → senão RCS (só com RCS, que pertence) → senão SMS
(2 números) + junto E-mail".

Aviso fixo no editor: "Travas que valem sempre: contato inválido, contestado ou que não
pertence ao cliente nunca recebe; WhatsApp só em número confiável ou com WhatsApp válido,
com freio por taxa de bloqueio; horário, domingo e feriado; 48h entre ações massivas."

Botão "Começar do playbook MotorCob" (só com a estratégia vazia): preenche as 5 abas com
o playbook atual como ações:
localizacao: 1 WhatsApp; 3 RCS, senão SMS + junto E-mail; 5 Agente virtual, reserva Discador;
  7 SMS + junto E-mail; dias_sem_contato_para_ncp 8.
cpc: ordem WhatsApp, RCS, Agente virtual, Discador, SMS; tentativas 3.
giro: igual à localização; ciclo 8; ciclos 3.
preventivo: 3 RCS, senão SMS + junto E-mail; 1 WhatsApp; 0 WhatsApp.
quebra: 1 WhatsApp; 3 Discador; 5 Discador + SMS (Sempre) + junto E-mail; estoque 6.

## Clusters (/clusters)
No formulário do cluster, novo campo "Estratégia" (select com as estratégias da empresa +
"Padrão da empresa" = null) → clusters.estrategia_id. No cartão do cluster, mostre o nome
da estratégia. Erro "a estratégia escolhida é de outra empresa" → "Escolha uma estratégia
desta empresa".

## Canais (/canais)
Tabela canais_empresa (empresa_id, canal, ativo, janela_inicio, janela_fim, sabado,
capacidade_dia, custo, tentativas_dia, respeitar_nao_perturbe). Um cartão por canal (os 6
sempre aparecem; se não houver linha, mostre os padrões e grave com upsert em
(empresa_id, canal) ao salvar):
- Ligado (ativo, padrão sim). Desligado: o canal não é usado por nenhuma estratégia.
- Horário: início e fim (HH:MM). Texto: "Nunca passa do horário geral (seg–sex 08:00–20:00,
  sábado 08:00–14:00)".
- Aciona no sábado (sabado, padrão sim).
- Capacidade por dia (capacidade_dia, vazio = sem limite). Texto: "Passou do limite, entram
  primeiro quebra/preventivo/CPC e, empatados, maior saldo".
- Custo por ação em R$ (custo).
- Tentativas por dia (tentativas_dia): só para Agente virtual e Discador (padrão 3).
- Respeitar Não Perturbe (respeitar_nao_perturbe): select "Padrão (voz respeita, digitais
  não)" = null, "Sim", "Não".
```

---

## Depois de publicar

1. Em **Estratégias**, crie uma estratégia com "Começar do playbook MotorCob", ajuste e
   marque como padrão (ou ligue a um cluster).
2. Em **Canais**, preencha horário, capacidade e custo de cada canal.
3. Envie um retorno de enriquecimento em **Enviar arquivos** e confira o relatório no dia
   seguinte.
