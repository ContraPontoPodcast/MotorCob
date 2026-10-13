# Prompt Horizons — Workspace 34: etapas da régua, orçamento por canal e Travas (MotorCob)

Rode depois do SQL 26. Protótipo aprovado: `07_workspace/etapas-prototipo.html` (abra no navegador).
O motor já lê tudo em `estrategias.definicao`; nenhuma tabela nova. A régua de cada etapa é o **mesmo
Desenho da Esteira de hoje** (arrastar canais para os dias, raias de persona, balão 💬 da frase).

```text
Orquestração › estratégia: acrescente a tela "Etapas da régua" (aba ao lado do Desenho da Esteira). Grava
em estrategias.definicao (jsonb) sem apagar as outras chaves. Admin e planejamento editam; os demais só veem.
Não crie, altere ou apague tabelas, views ou políticas.

## 1. Lista de etapas (coluna da esquerda)
Título "Etapas" + botão "+ Nova etapa". Legenda: "O cliente fica na primeira etapa da lista em que ele se
encaixa." Itens na ordem de definicao.ordem_etapas: as etapas da empresa (selo "Sua") e as fases do motor
(selo "Padrão": quebra=Quebra de acordo, preventivo=Preventivo, cpc=CPC, giro=Não CPC (giro),
localizacao=Cliente novo / não localizado). Setas ▲▼ mudam a ordem (grava ordem_etapas com todos os ids).
Fase padrão aberta: só a chave Ligada/Desligada (grava definicao.<fase>.ativo, como hoje) e o texto
"Quem entra e quando sai são regras do motor. Para outra regra de entrada, crie uma etapa sua acima desta."
Embaixo: botão "Travas" (abre a seção 4) e "Começar de um modelo": Em branco, Pré-judicial, Fidelização
pós-quitação, Campanha sazonal (só preenchem nome e um dia de exemplo).

## 2. Editor da etapa (definicao.etapas[i]) — seções numeradas
1 Etapa: nome (até 40) e descrição. id = nome em minúsculas sem acento, hífen no lugar de espaço (único;
  não pode ser quebra, preventivo, cpc, giro ou localizacao). Grave "ativo": true ao salvar.
2 Quem entra: o MESMO editor de condições dos Segmentos (campo, operador, valor; todas valem). Campos:
  saldo, dias_atraso, qtd_contratos, fase (localizacao, cpc, giro, preventivo, quebra) e as colunas da carga.
  Grava "condicoes": [{"campo","op","valor"}]. Mostre "Hoje esta etapa pegaria N clientes" só quando houver
  estimativa (pode omitir nesta versão).
3 Como contar os dias: "referencia": {"tipo": "entrada"|"atraso"|"vencimento"|"coluna", "coluna": "<nome>"}
  (Dias desde que entrou na etapa · Dias de atraso · Dias até o vencimento da parcela · Dias desde a data
  da coluna X), "de" e "ate" (inteiros; fora da janela o cliente segue a lista).
4 Régua: o componente do Desenho da Esteira (paleta de canais e de personas, raias, senão/+ junto/reserva,
  💬 frase, "Como vai funcionar"). Grava "passos": {"<dia>": [ações no formato de hoje]}. Acima da grade:
  "Não repete (D+de a D+ate)" ou "Repete em ciclo": ciclo de N dias (2 a 60) repetido X vezes (1 a 24) →
  "ciclo": {"dias": N, "vezes": X}; com ciclo as colunas são "dia 1…dia N" (passos 1..N) e a última coluna
  âmbar "↻ × X · repete o ciclo". Sem ciclo, colunas D+de…D+ate. Ao trocar, converta os dias (dia = D − de + 1).
5 Orçamento de envio: um botão por canal usado na régua ("WhatsApp · todos" / "WhatsApp · 300/dia").
  Rádio "Todos da raia" (envia para todos; nada abaixo vale) ou "Parametrizado":
  - "Até [N] clientes por dia" e/ou "Até [N] telefones por dia" (checkbox em cada; pelo menos um);
  - "Quem recebe primeiro": lista com checkbox e ▲▼; o 1º marcado é "Prioridade 0", o seguinte 1… Itens:
    novo (Cliente novo do dia) · nunca (Nunca acionado nesta etapa) · etapa_antigo / etapa_novo (Tempo na
    etapa: do mais antigo para o mais novo / do mais novo para o mais antigo) · acao_antiga / acao_recente
    (Última ação: da mais antiga para hoje / da mais recente para a mais antiga) · saldo_maior / saldo_menor
    · atraso_maior / atraso_menor · hot (Telefone Hot ou certificado primeiro) · coluna (Coluna da carga,
    maior primeiro: escolher a coluna). Pares opostos: marcar um desabilita o outro com a legenda "Não faz
    sentido com «…» marcada". Legenda: "A prioridade 0 sai primeiro; a seguinte desempata. Empate: ordem
    da carga.";
  - "Quem ficar fora do orçamento hoje": "Recebe o canal de baixo do dia (senão / reserva), se tiver" (senao)
    ou "Não recebe nada hoje; amanhã concorre de novo pela prioridade" (amanha).
  Grava "orcamento": {"<canal>": {"modo": "todos"|"parametrizado", "clientes": N|null, "telefones": N|null,
  "prioridade": ["novo", "etapa_antigo", {"criterio": "coluna", "coluna": "PRIO"}], "fora": "senao"}}.
  No chip do canal da paleta mostre o limite ("300/dia"). Simulação do protótipo: opcional.
6 Quando sai e para onde vai: chave + destino por evento. Eventos: cpc (Fez CPC), acordo (Fechou acordo),
  pagamento (Pagou), fim_janela (Terminou a janela sem resposta). Destinos: "padrao" (Volta para o fluxo
  padrão), "sai" (Sai da régua), "etapa:<id>" (Vai para <etapa>). Grava "saidas": {"cpc": "padrao", …};
  chave desligada = não grava o evento (fim_janela sem destino volta ao padrão).
7 Travas: "Usar as travas da estratégia" ou "Travas próprias nesta etapa": Intervalo entre ações (horas,
  mín. 12), Ações por dia, De e Até (dentro de 08:00–20:00) → "travas": {"intervalo_horas", "acoes_dia",
  "de", "ate"} (sem a chave = as da estratégia). As exigidas por lei valem sempre (texto fixo).
Rodapé: Cancelar · Salvar (toast "Etapa salva. Vale a partir da rotina de amanhã.").

## 3. Validação antes de salvar
Pelo menos uma condição e um dia com canal; de ≤ ate; com ciclo, passos só de 1 a N; ids únicos; destino
"etapa:<id>" só para etapa existente. Mostre os avisos de definicao processados pelo motor se houver.

## 4. Travas (painel da estratégia) → definicao.travas
Uma linha por trava com chave (liga/desliga), descrição e parâmetros. Faixas: o campo não aceita fora delas.
- intervalo: Esperar [48] horas (mín. 12) · Quem está em CPC: Segue todo dia | Respeita o intervalo
  → {"ligado", "horas", "cpc": "segue"|"respeita"}
- pausa_carteiras: Pausa [48] horas entre carteiras do mesmo CPF → {"ligado", "horas"}
- horario: De [08:00] Até [20:00] (entre 08:00 e 20:00) · Sábado: Normal | Até 14:00 | Não aciona
  → {"ligado", "de", "ate", "sabado": "normal"|"ate_14"|"nao"}. Texto: "Cada canal pode ter janela menor
  em Canais; vale a mais curta."
- domingo_feriado: Domingo: Não aciona | Só digitais | Normal · Feriados nacionais: Não aciona | Aciona
  → {"ligado", "domingo": "nao"|"digitais"|"normal", "feriados": "nacionais"|"nenhum"}
- limite_acoes: por dia / semana / mês (ações = canais acionados) → {"ligado", "dia", "semana", "mes"}
- ligacoes: Tentativas do discador por número por dia [3] (1 a 10) → {"ligado", "por_dia"}
- nao_perturbe: Quem respeita: Voz (padrão) | Todos os canais → {"ligado", "quem": "voz"|"todos"}
- freio_whatsapp: Taxa de bloqueio máxima [3] % (até 5) a partir de [500] envios no dia
  → {"ligado", "taxa", "minimo"}
Fixas, com cadeado e selo "Sempre ligada" (sem chave): Opt-out e descadastro · Contato de terceiro ·
Clientes bloqueados (óbito, judicial, reclamação). Botão "Salvar travas".

## 5. Lista do dia
Motivos novos (com o texto ao lado): sem_orcamento "Ficou fora do orçamento do canal (concorre amanhã)" ·
limite_acoes "Atingiu o limite de ações por cliente" · etapa_sem_passo "Em uma etapa da empresa, sem passo
hoje" · saiu_da_regua "Saiu da régua pela regra de uma etapa". Régua "etapa-<id>" aparece com o nome da etapa
e o passo (D+3, ou C2-D3 = 2º ciclo, dia 3).

Confira em 1440 e 390 px: a esteira rola na horizontal dentro do bloco, sem rolagem lateral da página.
```
