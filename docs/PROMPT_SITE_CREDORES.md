# Prompt de ajuste do site: credores e os arquivos da carteira

Antes de colar, rode no Supabase (SQL Editor › New query › colar o conteúdo › Run)
`supabase/migrations/20261005000001_credores.sql` — ou `supabase/atualizar_producao_2026-10.sql`,
que já inclui esta e as anteriores de outubro. Os dois podem ser rodados mais de uma vez.
Toda empresa ganha o credor "principal" (Carteira principal), com os dados que já existiam.

---

```text
Adapte o site MotorCob para CREDORES: cada empresa tem uma ou mais carteiras (credores);
todo arquivo é de um credor, e a estratégia, a lista do dia e os números são por credor.
NÃO crie, altere ou apague tabelas, views, buckets ou políticas: o banco já foi alterado.

## Dados novos
- credores (id, empresa_id, codigo, nome, ativo, estrategia_id, criado_em). codigo: minúsculas,
  números e hífen (ex.: "banco-x"), único na empresa. estrategia_id = estratégia padrão do credor.
  Admin e planejamento criam e editam; ninguém apaga (credor que sai fica ativo = false).
- credor_id em: envios, execucoes, estado_cliente, trilha, fila_dia, acoes_dia, personas,
  sugestoes, kpis e clusters (em clusters, credor_id vazio = o segmento vale para todos os
  credores da empresa). As views mapa_esteira, acoes_hoje, fluxo_esteira, resumo_estados,
  resumo_fila e ultima_execucao também têm credor_id (ultima_execucao: uma por credor).

## Seletor de credor (topo, ao lado do seletor de empresa)
Select com os credores ativos da empresa (nome) e, primeiro, "Todos os credores". Guarde a
escolha na URL (?credor=banco-x) e no localStorage. Empresa com um credor só: mostre o nome
dele sem select. Ao trocar de empresa, volte para "Todos os credores".
Em TODA consulta das tabelas/views acima, com um credor escolhido acrescente
.eq('credor_id', id); com "Todos os credores", some os números de todos (Início, Mapa da
Esteira, Ações, Personas, Comitê). Páginas que precisam de um credor (Lista do dia,
Orquestração, Cliente quando houver o mesmo ID em mais de um) pedem para escolher:
"Escolha o credor no topo".

## Página Credores (/credores) — no menu logo depois de "Orquestração"
Tabela: nome, código, estratégia padrão (nome da estratégia ou "Padrão da empresa"), ativo,
criado em, e o resumo da última rotina do credor (ultima_execucao.resumo.carteira:
em_cobranca, retirados, acordos_abertos, quitados). Botão "+ Credor" (admin e planejamento):
nome; código gerado do nome (minúsculas, sem acento, espaços viram hífen) e editável;
estratégia padrão (select das estratégias da empresa, opcional). Editar: nome, estratégia
padrão, ativo (switch "Em cobrança"). O código não muda depois de criado.

## Enviar arquivos
No topo do bloco de envio, "Credor" (obrigatório; já vem o do seletor do topo; empresa com um
credor só: fixo). Botões grandes, nesta ordem, cada um com a sua explicação:
1. "Carga geral" (tipo base) — "A carteira toda do credor em cobrança. Substitui a anterior:
   quem não vier nela sai das ações."
2. "Carga incremental" (tipo incremental) — "Contratos novos ou atualizados. Somam à carga geral."
3. "Retirada" (tipo retirada) — "Contratos que saem da cobrança, com o motivo. Param de ser
   acionados na hora."
4. "Acordo" (tipo acordo) — "O acordo formalizado, uma linha por parcela com o vencimento.
   O cliente passa para Preventivo / Acordo em dia e o MotorCob lembra antes de cada vencimento."
5. "Baixa / pagamento" (tipo baixa) — "Pagamentos: parcela de acordo, quitação ou parcial.
   Quitado vira Liquidado e sai das ações."
6. "Ocorrência" (tipo ocorrencia) — como antes.
7. "Atualização de contatos (bureau)" (tipo enriquecimento) — aqui o credor é opcional, com a
   opção "Todos os credores" (credor_id vazio).
O insert em envios passa a levar credor_id. Caminho no Storage igual: {slug}/{tipo}/{data}/
{timestamp}_{nome} (tipo = base, incremental, retirada, acordo, baixa, ocorrencia,
enriquecimento). O cartão de andamento (Carga recebida → Gerando a lista → Lista pronta) vale
para os 5 primeiros tipos; a execução esperada é a do mesmo credor (ultima_execucao com o
credor_id do envio).
Tabela de envios: coluna "Credor". No relatório processado mostre, conforme o tipo:
carga → linhas, clientes, "em cobrança" (na_carga) e "fora" (fora_da_carga); retirada →
retirados por motivo; acordo → acordos_abertos; baixa → parcelas_pagas e pagamentos
(quitação / parcial); avisos, se houver. Erro: relatorio.erro em vermelho.

## Orquestração
Mostra os segmentos do credor escolhido: clusters com credor_id = credor OU credor_id vazio
(estes com a etiqueta "todos os credores"). "+ Segmento" grava credor_id = credor escolhido,
com a opção "Valer para todos os credores" (credor_id vazio). O item fixo "Demais clientes"
usa a estratégia padrão DO CREDOR (credores.estrategia_id; se vazia, a padrão da empresa) e,
ao trocar a estratégia ali, grava em credores.estrategia_id.

## Lista do dia
Os arquivos do credor ficam em saidas/{slug}/{data}/{codigo do credor}/ids/{canal}.csv (e
fila_do_dia.csv na mesma pasta). Para datas anteriores à mudança, se a pasta do credor não
existir, use a antiga saidas/{slug}/{data}/ids/. Título: "Lista do dia · {nome do credor}".

## Comitê
Arquivos em saidas/{slug}/comite/{mês}/{codigo do credor}/ (antigos: sem o credor).
kpis filtrados por credor_id.

## Início
Com "Todos os credores": funil e "Ações de ontem" somando os credores e, embaixo, uma linha
por credor (nome, em cobrança, CPC A, acordo, ações de ontem, hora da última rotina, status).
Com um credor: como hoje, só dele, mais o cartão "Carteira" (resumo.carteira da última
execução do credor): em cobrança, fora, retirados por motivo, acordos abertos, parcelas
pagas, quitados.

## Cliente
A busca por ID mostra um cartão por credor em que o ID existir (nome do credor no título).
```
