# Prompt de ajuste do site: versão simples da operação

O site fica com o fluxo da operação na frente: **carga do credor → lista do dia →
ocorrência (CPC sim/não)**. Clusters, estratégias, canais, empresas e usuários continuam
existindo, mas vão para um grupo "Avançado".

Antes de colar, aplique no Supabase a migração
`supabase/migrations/20261002000001_numeros_por_cliente.sql` (SQL Editor › New query ›
colar o conteúdo › Run).

---

```text
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
Início · Enviar arquivos · Orquestração · Lista do dia (a antiga "Fila do dia") · Cliente ·
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
```

---

## Depois de publicar

Entre com o seu usuário e confira: menu com "Avançado" recolhido, Início com o funil e os
contatos por status, e "Enviar arquivos" com os 3 tipos.
