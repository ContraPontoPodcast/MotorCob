# Prompt do site: intervalo do CPC, Lista do dia por estratégia e calendário do credor

Pré-requisito: `20261018000001_lista_por_estrategia_calendario.sql` aplicado (também está no fim de
`supabase/atualizar_producao_2026-10.sql`) e o motor atualizado no Mac (`git pull`).

---

```text
Três ajustes. NÃO crie, altere ou apague tabelas, views, buckets ou políticas (o SQL já foi aplicado).

## 1. Orquestração: intervalo de acionamento do CPC A e do CPC B
Na faixa "Deu CPC · CPC A e CPC B" do Desenho da Esteira, acrescente dois campos numéricos
(1 a 30, só inteiros), lado a lado, acima da ordem dos canais:
- "CPC A: acionar a cada [ 1 ] dia(s)"  → definicao.cpc.intervalo_cpa
- "CPC B: acionar a cada [ 1 ] dia(s)"  → definicao.cpc.intervalo_cpb
Valor 1 mostra o complemento "(todo dia de lista)". Campo vazio = 1. Grave como número no mesmo
estrategias.definicao (sem mexer no resto da faixa). Texto de ajuda: "Conta a partir da última ação
de CPC enviada para o cliente. Ex.: 3 = acionou na segunda, volta na quinta."
No resumo da faixa (subtítulo), inclua: "CPC A a cada N dias · CPC B a cada M dias".

## 2. Lista do dia separada por estratégia
A rotina agora gera, para cada estratégia, uma pasta própria no Storage (bucket "saidas"):
  {pasta do dia}/ids/estrategias/indice.json
  {pasta do dia}/ids/estrategias/{pasta}/{canal}.csv   (e {canal}_reserva.csv quando houver)
onde {pasta do dia} é a mesma de hoje ({slug}/{data}/{codigo do credor}). O indice.json é uma lista:
  [{"pasta": "7-negociacao", "estrategia": "Negociação", "estrategia_id": 7, "clientes": 812,
    "canais": {"whatsapp": 640, "sms": 172}, "reserva": {"discador": 40}}]
Na página Lista do dia:
- Leia o indice.json do dia/credor. Mostre UM BLOCO POR ESTRATÉGIA (na ordem do índice), recolhível,
  com o título = nome da estratégia, "{clientes} clientes" e os cartões de canal dela (mesmo visual
  de hoje: ícone, nome do canal, nº de clientes, "Baixar lista"). O "Baixar lista" de cada cartão
  baixa {pasta}/{canal}.csv da estratégia; se houver reserva do canal, um link menor "reserva
  ({n})" baixa {pasta}/{canal}_reserva.csv.
- Em cada bloco, o botão "Baixar {estratégia} (.zip)": zip só com os arquivos daquela estratégia
  (nomes {canal}.csv dentro do zip "{data}_{pasta}.zip").
- NÃO mostre mais os cartões de canal com tudo junto. O botão do topo vira "Baixar todas (.zip)",
  com uma pasta por estratégia dentro do zip ({pasta}/{canal}.csv).
- Filtro no topo com chips das estratégias do dia (todas marcadas): esconde/mostra blocos.
- Os números também estão na view resumo_fila_estrategia (empresa_id, credor_id, data,
  estrategia, canal, reserva, clientes) se precisar sem baixar o índice.
- Dia antigo sem indice.json: mostre a tela antiga (cartões por canal) com a nota cinza "Lista
  anterior à separação por estratégia".
- O bloco "Por que hoje" continua igual, acima dos blocos.

## 3. Credor → Configurações → aba "Calendário"
Nova aba ao lado de "Arquivos" e "Ocorrências" (mesma área de Configurações do credor). Edição só
admin e planejamento. Grava em credores.calendario (jsonb) do credor, com atualizado_em = now().
Formato (dias_semana: 0 = segunda … 6 = domingo):
  {"padrao": {"dias_semana": [0,1,2,3,4,5], "feriados_nacionais": true,
              "sem_acao": ["2026-11-24"], "com_acao": []},
   "estrategias": {"7": {"seguir_padrao": false, "dias_semana": [0,1,2,3,4],
                         "feriados_nacionais": true, "sem_acao": [], "com_acao": []}}}
Tela:
- Cartão "Padrão do credor": 7 caixas Seg Ter Qua Qui Sex Sáb Dom (padrão: Seg a Sáb marcados);
  chave "Não exportar em feriado nacional" (padrão ligada); "Datas sem exportação" (lista de datas
  com + e ×, ex.: feriado municipal); "Datas com exportação mesmo assim" (exceções, ex.: um
  feriado em que a operação trabalha).
- Cartão "Por estratégia": uma linha por estratégia usada por este credor (a estratégia padrão do
  credor e as dos segmentos em uso nele — view segmentos_em_uso com em_uso = true). Em cada linha,
  a chave "Seguir o padrão do credor" (ligada por padrão). Desligada, abre os mesmos campos do
  padrão para aquela estratégia (seguir_padrao = false + os campos).
- Prévia embaixo: "Próximos 14 dias" — um quadradinho por dia, verde = exporta, cinza = não, uma
  linha por estratégia (calcule no site com as mesmas regras: dia da semana marcado; feriado
  nacional só se a chave estiver ligada; datas sem/com exportação).
- Botão "Salvar calendário". Toast: "Calendário salvo · vale a partir da próxima rotina (em até 1
  minuto)".
- Texto de ajuda: "Nos dias sem exportação, a Lista do dia não traz os clientes daquela estratégia e
  a esteira dela pausa (o D+ não anda). Os feriados nacionais já estão cadastrados no MotorCob."
Sem calendário salvo, mostre o padrão (Seg a Sáb, sem exportar em feriado nacional) — é o que o motor usa.
```
