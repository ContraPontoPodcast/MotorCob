# Prompt do site: Configurações do credor (mapeamento de arquivos e ocorrências) e preventivo

Pré-requisito: `20261017000001_mapeamento_arquivos.sql` aplicado (também está no fim de
`supabase/atualizar_producao_2026-10.sql`).

---

```text
Crie a área "Configurações" dentro de cada credor (carteira). É onde o cliente aponta, UMA VEZ,
para quais colunas o MotorCob olha nos arquivos de ocorrência, acordo e pagamento, e marca quais
resultados de ocorrência são CPC. NÃO crie, altere ou apague tabelas, views, buckets ou políticas.
Edição só para admin e planejamento; os outros papéis veem em modo leitura.

## Dados (Supabase)
- mapeamento_arquivos (empresa_id, credor_id, tipo 'ocorrencia'|'acordo'|'baixa', colunas jsonb,
  confirmado bool, sugerido jsonb, cabecalho jsonb = lista dos nomes de coluna do último arquivo,
  arquivo, visto_em, atualizado_em). O motor grava sugerido/cabecalho/arquivo/visto_em; o site grava
  colunas, confirmado e atualizado_em.
- ocorrencia_codigos (empresa_id, credor_id, codigo, resultado 'cpc'|'sem_contato'|'terceiro'|'opt_out'
  ou null, mapeado bool, sugerido, qtd, primeira_vez, ultima_vez). O motor cria os códigos que aparecem;
  o site grava resultado, mapeado = true e atualizado_em = now().
- Ao gravar, envie sempre atualizado_em = now() (é o que faz o MotorCob reprocessar em até 1 minuto).
  Ao inserir, basta credor_id (a empresa vem do credor).

## Onde fica
Na página Credores, cada linha ganha o botão "Configurações" (ícone de engrenagem) que abre
/credores/{codigo}/configuracoes (ou um painel lateral grande), com duas abas: "Arquivos" e
"Ocorrências". Na linha do credor, um selo âmbar "N pendências" quando houver
mapeamento_arquivos com confirmado = false ou ocorrencia_codigos com mapeado = false; clicar abre
as Configurações na aba certa.

## Aba "Arquivos"
Um cartão por tipo, nesta ordem: Ocorrência, Acordo, Pagamento.
- Sem linha em mapeamento_arquivos: texto cinza "Ainda não chegou arquivo de {tipo}. Envie o primeiro
  em Enviar arquivos e volte aqui para apontar as colunas."
- Com linha: selo verde "Confirmado" (confirmado = true) ou âmbar "Aguardando mapeamento — os
  arquivos esperam até você confirmar". Mostre "Último arquivo: {arquivo}".
- Um campo por informação, cada um um <select> com as opções = cabecalho (mais "— não tem —" nos
  opcionais). Valor inicial: colunas[campo] se confirmado, senão sugerido[campo] (marque com
  "sugestão do MotorCob" em cinza ao lado).
  Ocorrência: Cliente* (código, contrato ou CPF — "id_cliente"), Data da ação* ("data"),
  Resultado/ocorrência* ("resultado"), Canal ("canal"), Telefone/e-mail acionado ("contato").
  Acordo: Cliente ("id_cliente") e/ou Contrato ("id_contrato") — pelo menos um*, Número do acordo
  ("id_acordo"), Parcela* ("parcela"), Vencimento* ("vencimento"), Valor da parcela ("valor").
  Pagamento: Cliente ("id_cliente") e/ou Contrato ("id_contrato") — pelo menos um*, Data do
  pagamento* ("data"), Valor pago* ("valor"), Número do acordo ("id_acordo"), Parcela ("parcela"),
  Tipo (quitação/parcial/parcela) ("tipo").
- Botão "Confirmar colunas": update mapeamento_arquivos set colunas = {só os campos preenchidos},
  confirmado = true, atualizado_em = now(). Não deixe confirmar sem os obrigatórios (*), nem com a
  mesma coluna em dois campos. Toast: "Colunas confirmadas · o MotorCob processa os arquivos em até
  1 minuto". Depois de confirmado, o cartão fica fechado com o resumo ("Cliente = CPF · Data =
  DT_ACAO · Resultado = TABULACAO") e o botão "Alterar".

## Aba "Ocorrências"
Texto no topo: "Marque o que cada resultado significa. Sem marca = não é CPC (sem contato). Feito
uma vez, vale para os próximos arquivos; resultado novo aparece aqui com o selo NOVO e as linhas
dele esperam até você marcar."
Tabela de ocorrencia_codigos do credor, primeiro os não mapeados (mapeado = false), depois por qtd
desc. Colunas:
- Resultado (o código, em negrito) + selo âmbar "NOVO" quando mapeado = false;
- Linhas (qtd) · Primeira vez · Última vez (dd/mm/aaaa);
- Sugestão do MotorCob (sugerido: cpc → "CPC", terceiro → "Número errado", opt_out → "Não contatar",
  sem_contato/null → "Sem contato"), em cinza;
- três caixas de marcar: "CPC", "Número errado / de outra pessoa", "Não contatar (opt-out)". Só uma
  pode ficar marcada (marcar uma desmarca as outras); nenhuma = sem contato.
Cada clique grava na hora: update ocorrencia_codigos set resultado = 'cpc'|'terceiro'|'opt_out'
(ou 'sem_contato' se nenhuma), mapeado = true, atualizado_em = now() where id = ... Linha não
mapeada mostra as caixas vazias e, embaixo, "aceitar sugestão" (link) que grava o sugerido.
Botão no topo "Aceitar as sugestões dos novos" (com confirmação): para cada mapeado = false, grava
resultado = coalesce(sugerido, 'sem_contato'), mapeado = true, atualizado_em = now().
Resumo acima da tabela: "{n} resultados · {n_cpc} contam como CPC · {n_novos} novos para marcar".

## Copiar de outro credor
Nas duas abas, botão "Copiar de outro credor" → escolher o credor de origem (da mesma empresa) →
prévia ("3 mapeamentos de arquivo e 18 resultados de ocorrência") → confirmar:
- para cada mapeamento_arquivos da origem com confirmado = true: upsert no credor atual
  (onConflict: empresa_id,credor_id,tipo) com colunas, confirmado = true, atualizado_em = now();
- para cada ocorrencia_codigos da origem com mapeado = true: upsert no credor atual
  (onConflict: empresa_id,credor_id,codigo) com codigo, resultado, mapeado = true, atualizado_em = now().
Não apague nada do credor atual. Toast: "Configurações copiadas de {origem}".

## Enviar arquivos (Histórico)
Status novo "aguardando": selo âmbar "aguardando mapeamento" e, embaixo do nome, o texto de
relatorio.aguardando, com o link "Abrir configurações do credor" (aba Arquivos ou, se houver
relatorio.codigos_novos, aba Ocorrências).

## Orquestração: preventivo pelo vencimento
Na faixa "Clientes em acordo (preventivo e quebra)":
- Preventivo: as colunas são dias ANTES do vencimento de cada parcela: hoje são fixas D-3, D-1 e
  D0. Troque por colunas editáveis: comece com D-3, D-1, D0 e o botão "+ dia antes" que acrescenta
  D-4, D-5 … até D-15 (e × para tirar uma coluna vazia). Grave como hoje, em
  definicao.preventivo.passos com a chave negativa ("-5", "-3", "-1", "0"). Rótulo "D-5".
  Texto: "Dias antes do vencimento de cada parcela do acordo. Cada parcela recomeça a contagem."
- Quebra: "Dias depois do vencimento sem pagamento (D+1, D+2…)" — como está.
```
