# Prompt único de atualização do site (outubro/2026)

Este é o **único prompt que falta colar** no Hostinger Horizons. Ele junta a versão simples
da operação (menu, envios, Orquestração, Lista do dia com contatos por cliente) e o Mapa
da Esteira. Os prompts de multiempresa e de estratégias já foram aplicados antes.

Antes de colar, rode no Supabase (SQL Editor › New query › colar o conteúdo › Run) o
arquivo `supabase/atualizar_producao_2026-10.sql`. Ele pode ser rodado mais de uma vez.

---

```text
Atualize o site MotorCob em duas partes: (A) versão simples da operação e (B) a página
Mapa da Esteira. O banco já foi alterado — NÃO crie, altere ou apague tabelas, views,
buckets ou políticas. Não apague páginas existentes; reorganize como descrito.

# PARTE A — Versão simples da operação
Simplifique o site MotorCob. NÃO crie, altere ou apague tabelas, views, buckets ou
políticas. Não apague páginas: só reorganize o menu, os textos e a página Início como
abaixo. Tudo continua filtrado pela empresa selecionada.

## Como a operação funciona (use estes nomes em todo o site)
1. Todo dia a empresa envia a CARGA DO CREDOR (base de devedores com dívida e contatos —
   pode ser a carteira toda, o colchão ou o preventivo). Só quem está na carga do dia
   recebe ação.
2. O MotorCob gera a LISTA DO DIA: para cada canal (WhatsApp, RCS, SMS, E-mail, Agente
   virtual, Discador), um contato por cliente.
3. A empresa devolve a OCORRÊNCIA dizendo se cada cliente deu CPC ou não.
4. O telefone/e-mail que deu CPC vira HOT (prioritário) e o canal do CPC fica marcado: o
   cliente passa para CPC A e as próximas ações saem por esse canal, nesse contato.
Status do contato: HOT (deu CPC ou veio marcado como preferencial), WHATSAPP (tem
WhatsApp), RCS (tem RCS), NEUTRO (sem validação), INVÁLIDO (não pertence, inexistente).
Status do cliente (estado da TAG): Não localizado = LOC e NCP; CPC A = CPA; CPC B = CPB;
Acordo = PRE, COL e QBR; Liquidado = LIQ; Bloqueado = BLQ.

## Menu
Início · Mapa da Esteira · Enviar arquivos · Orquestração · Lista do dia (a antiga "Fila do dia") · Cliente ·
Painel · Comitê. Depois um grupo recolhido "Avançado" (só admin e planejamento) com:
Canais, Empresas (só equipe admin), Usuários (admin).

## Orquestração (/orquestracao) — junta Clusters e Estratégias numa página só
É onde a empresa desenha o que mandar para cada segmento. Texto no topo: "Cada cliente da
carga cai num segmento. O MotorCob vê em que momento ele está — Novo, CPC A, Não CPC,
Acordo — e aplica a regra desse momento. Quem deu CPC segue no contato Hot e no canal
do CPC."
- Coluna da esquerda: "Segmentos" = lista dos clusters (tabela clusters, em ordem), mais
  um item fixo no fim "Demais clientes" (quem não cai em nenhum segmento = estratégia
  padrão da empresa). Botões "+ Segmento", Subir/Descer. Clicar abre à direita.
- À direita, para o segmento escolhido:
  1. "Quem entra": as condições do cluster (mesmo formulário da página Clusters).
  2. "Estratégia": select com as estratégias da empresa + "Nova estratégia". Mostra a
     estratégia escolhida em 3 abas grandes, com os nomes da operação, e as 2 de acordo
     menores:
     - "Novo" (localização): passos por dia com o blend de canais;
     - "CPC A / CPC B": ordem dos canais quando o canal do CPC parar de responder (o canal
       do CPC e o contato Hot sempre vêm primeiro — texto fixo);
     - "Não CPC" (giro): passos do ciclo, ciclos;
     - "Preventivo" e "Quebra" (acordo).
     É o mesmo editor da página Estratégias (grava em estrategias.definicao); se a
     estratégia for usada por outros segmentos, avise "Esta estratégia também vale para:
     …" antes de salvar.
- As páginas Clusters e Estratégias antigas saem do menu (as rotas podem continuar).

## Início
- Card "Última rotina" como já existe (ultima_execucao), com "Carga do dia:
  {resumo.na_carga} clientes".
- Funil em 4 blocos lado a lado (de resumo.estados da ultima_execucao, somando):
  Não localizado (LOC+NCP) → CPC A (CPA) → CPC B (CPB) → Acordo (PRE+COL+QBR), com o
  número e o % do total; e ao lado, menores, Liquidado (LIQ) e Bloqueado (BLQ).
- "Contatos dos clientes na carga" (resumo.contatos): chips HOT, WHATSAPP, RCS, NEUTRO,
  INVÁLIDO com as quantidades. HOT em verde (#2E7D32), INVÁLIDO em vermelho (#C62828),
  os demais neutros.
- Mantenha os alertas da rotina em destaque (âmbar).

## Enviar arquivos
Mostre só 3 tipos, como 3 botões grandes de envio (arrastar e soltar), nesta ordem:
1. "Carga do credor" (tipo base) — "A base do dia, do jeito que vem. Só quem está nela
   recebe ação hoje."
2. "Ocorrência" (tipo ocorrencia) — "O retorno da empresa dizendo, por cliente, se deu CPC.
   Não precisa trazer o telefone: o MotorCob sabe qual contato foi acionado."
3. "Atualização de contatos (bureau)" (tipo enriquecimento) — "O arquivo que volta do
   enriquecimento, com telefones, WhatsApp e RCS."
Os outros tipos (retorno de fornecedor, parcelas, clientes, contatos, portal) ficam num
link discreto "Outros tipos de arquivo" que abre o formulário completo de antes.
O caminho e o insert em envios continuam iguais ({slug}/{tipo}/{data}/{timestamp}_{nome}).
Abaixo, a tabela de envios como já existe; no relatório da carga mostre
"na_carga" e "fora_da_carga", no da ocorrência "aceitas" e "contato_identificado".

## Lista do dia (antiga Fila do dia)
Mesmos downloads de antes (ids/{canal}.csv com id_cliente;contato). Troque os textos:
título "Lista do dia"; ajuda "Um contato por cliente em cada canal. O contato HOT do
cliente sempre vai primeiro." Para admin e planejamento, o arquivo de detalhe
fila_do_dia.csv agora tem a coluna status_contato (HOT, WHATSAPP, RCS, NEUTRO).

## Contatos por cliente (na página Lista do dia, para admin e planejamento)
Bloco "Contatos por cliente em cada canal": uma linha por canal (WhatsApp, RCS, SMS,
E-mail, Agente virtual, Discador) com um seletor "1 (recomendado)", "2", "3", "Todos".
Grava em canais_empresa.numeros_por_cliente da empresa (upsert em (empresa_id, canal);
1 = null, Todos = 99). Texto de ajuda: "Com 1 contato, o CPC da ocorrência marca na hora
qual é o telefone Hot. Com mais de um, o CPC vale para o cliente e o MotorCob descobre o
Hot testando um telefone por vez nas próximas ações." Vale a partir da rotina seguinte.
A página Canais (Avançado) mostra o mesmo campo.

## Cliente
Na TAG decomposta, mostre o estado com o nome da operação (Não localizado, CPC A, CPC B,
Acordo, Liquidado, Bloqueado) e, entre parênteses, o código (LOC, CPA…).

# PARTE B — Mapa da Esteira
Página "Mapa da Esteira" (/mapa). Todos os papéis veem. Tudo filtrado pela empresa
selecionada (.eq('empresa_id', id)). No menu, logo abaixo de "Início". Use nas caixas e
tabelas os nomes da operação: LOC = "Novo · localizando", NCP = "Não CPC", CPA = "CPC A",
CPB = "CPC B", PRE = "Preventivo", COL = "Acordo em dia", QBR = "Quebra",
LIQ = "Liquidado", BLQ = "Bloqueado".

## Dados
- view mapa_esteira (empresa_id, estado, etapa, canal, cluster, safra, clientes, saldo):
  clientes e saldo por estado × etapa × canal × cluster × safra (AAAA-MM de entrada).
  Leia uma vez por empresa e some no navegador conforme o mapa e os filtros.
- view acoes_hoje (empresa_id, data, regua, passo, canal, reserva, clientes): a fila do
  dia agregada por régua × passo × canal.
- view fluxo_esteira (empresa_id, data, de, para, clientes): mudanças de estado por dia;
  de = null é entrada na esteira. Filtre data >= hoje − N dias e some por (de, para).
- view resumo_fila (empresa_id, data, canal, reserva, clientes) com data = hoje, e
  fila_dia (empresa_id, data, id_cliente, tag) com data = hoje para contar "com ação
  hoje" por estado (estado = 3ª parte da tag separada por "-").
- view ultima_execucao da empresa: data/hora da rotina, mostrada no topo.

## Topo
Título "Mapa da Esteira" e a frase "Onde está a base hoje em cada etapa dos acionamentos,
e quem se moveu entre elas." Controles:
- Mapa (o primeiro controle, em destaque): escolhe a visão —
  "Esteira · etapas e movimento" (padrão), "Clusters × etapas", "Canais × etapas",
  "Safras × etapas", "Ações de hoje · régua × canal".
- Medir por: Clientes | Saldo (botões segmentados).
- Cluster: Todos + os valores distintos de cluster em mapa_esteira (mostre o nome do
  cluster da tabela clusters quando existir: "VE · Veículo"; os códigos A1…B3 aparecem
  como "Padrão").
- Canal: Todos, WhatsApp (WA), RCS (RC), Agente virtual (AV), Discador (DC), SMS (SM),
  E-mail (EM), Nenhum (ND = ainda sem canal).
- Safra: Todas + os meses distintos de safra (mostre "set/26").
- Movimento: últimos 7 dias | últimos 30 dias.
Os filtros valem para todos os mapas e se combinam. Abaixo dos controles, chips com os
filtros ativos ("Cluster: VE ✕", "Canal: WhatsApp ✕", "Limpar filtros") ou "Sem filtros:
base inteira.". Guarde mapa e filtros na URL (?mapa=cluster&cluster=VE…) para poder
compartilhar a visão.
Linha de totais: clientes na esteira (todos menos LIQ), saldo, com ação hoje, data da
rotina.

## Mapa (SVG, largura total, rolagem horizontal no celular)
Caixas fixas, da esquerda para a direita, com uma linha tracejada separando
"Réguas massivas" de "Acordo":
- Entrada (novos na esteira: soma de fluxo_esteira com de = null no período)
- Localização (LOC) e, abaixo, Não CPC (NCP)
- CPC A (CPA) e, abaixo, CPC B (CPB)
- | Acordo: Colchão (COL), Preventivo (PRE), Quebra (QBR)
- Liquidado (LIQ) e Bloqueado (BLQ)
Cada caixa: nome, subtítulo (Cliente novo, Giro, Negociação, Tentativas, Acordo em dia,
Antes do vencimento, Parcela vencida, Quitado, Opt-out/óbito…), o número grande
(clientes ou saldo, conforme "Medir por"), a outra medida menor, "% da base" e "N com ação
hoje". A cor de fundo da caixa vai do claro ao azul-petróleo (#0F4C5C) conforme a
concentração (maior caixa = mais escura); texto branco nas escuras.
Setas curvas entre as caixas para cada par (de, para) do período, com espessura
proporcional à quantidade e o número no meio da seta (mostre o número nas setas mais
grossas e em todas as setas ligadas à caixa selecionada). Tooltip: "Localização → CPC A:
210 clientes".
Clique numa caixa seleciona (borda âmbar #E9A23B) e destaca as setas dela.

## Mapas em tabela (Clusters, Canais, Safras × etapas)
Tabela-mapa de calor: linhas = clusters / canais / safras; colunas = Localização, Não CPC,
CPC A, CPC B, Preventivo, Colchão, Quebra, Bloqueado, Liquidado, Total. Cada célula mostra
clientes ou saldo e tem fundo do claro ao azul-petróleo conforme o valor (texto branco
nas escuras; célula zerada mostra "·"). Legenda curta acima da tabela explicando a
visão. Clicar no nome da linha aplica (ou tira) aquele filtro. Clicar numa célula aplica
o filtro da linha e seleciona a etapa da coluna, abrindo o painel abaixo (borda âmbar
na célula selecionada). Tabela com rolagem horizontal no celular.

## Ações de hoje
Tabela-mapa de calor com linhas = régua · passo (ex.: "Localização · D+1", "CPC B · T2")
e colunas = canais (a reserva aparece como "Discador (reserva)"), com total por linha.
Respeita os filtros de cluster/canal/safra só quando der para cruzar com fila_dia (se não
der, mostre a nota "Ações de hoje não usa os filtros de cluster e safra").

## Painel da caixa selecionada (cartões abaixo do mapa)
1. "Por etapa": barras horizontais por etapa, na ordem natural (LOC: L0, L1…; NCP: G1,
   G2, G3 e RE = "Parado · aguarda enriquecimento"; CPB: T1…T3; PRE: D-3, D-1, D0;
   QBR: D1…D5 como "D+1"…). Em NCP, se houver RE, mostre em âmbar: "N clientes parados
   esperando novo enriquecimento: envie o retorno do bureau para eles voltarem ao giro."
2. "Canal da vez" (só CPA, CPB, PRE, QBR, COL): barras por canal (WA WhatsApp, RC RCS,
   AV Agente virtual, DC Discador, SM SMS, EM E-mail, ND Nenhum).
3. "Por cluster": barras por cluster dentro da caixa.
4. "Movimento": chips com de onde vieram e para onde foram os clientes no período.
Estado vazio (empresa sem rotina ainda): "O mapa aparece depois da primeira rotina desta
empresa."
Não existe telefone, e-mail ou CPF nessas views — não tente exibir.
```

---

## Depois de publicar

1. Entre com o seu usuário e escolha a empresa no topo.
2. Confira o menu: Início · Mapa da Esteira · Enviar arquivos · Orquestração · Lista do dia
   · Cliente · Painel · Comitê · Avançado (recolhido).
3. O Mapa e o funil do Início aparecem depois da primeira rotina com a carga da empresa.
