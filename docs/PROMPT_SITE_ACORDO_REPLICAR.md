# Prompt do site — Acordo por estratégia (dias da quebra, liga/desliga) e Replicar estratégia

Sem SQL: tudo fica no jsonb `estrategias.definicao`. Cole no Hostinger Horizons:

---

Três evoluções na Orquestração (desenho da estratégia de cada segmento).

## 1. "Clientes em acordo (preventivo e quebra)" — liga/desliga e dias livres

Na seção **Clientes em acordo (preventivo e quebra)** da estratégia, dois blocos, cada um com um **interruptor ON/OFF**
no cabeçalho:

**Preventivo** — interruptor grava `definicao.preventivo.ativo` (true/false; ausente = ligado).
- OFF: o bloco fica recolhido/cinza com o texto "Preventivo desligado neste segmento: clientes em acordo não
  recebem lembrete antes do vencimento." (os passos desenhados continuam salvos, só não valem).
- ON: a grade dos dias **antes do vencimento** passa a ser **livre**: botão "+ dia" para incluir D-N (1 a 30) e "×"
  para remover a coluna. Ordem: do mais distante ao D0. Grava como hoje em `definicao.preventivo.passos`
  (chaves "-5", "-3", "0"…). Texto: "Dias antes do vencimento de cada parcela do acordo. Cada parcela recomeça a
  contagem."

**Quebra** — interruptor grava `definicao.quebra.ativo` (true/false; ausente = ligado).
- Campos numéricos (valem com a quebra ligada ou desligada):
  - **Carência** → `definicao.quebra.carencia` (0 a 60; padrão 0): "Dias depois do vencimento, sem baixa, que
    ainda não contam como quebra (tempo para o pagamento compensar). A quebra começa no D+(carência+1)."
  - **Volta ao estoque depois de** → `definicao.quebra.dias_para_estoque` (1 a 90; padrão 6): "Dias depois do
    vencimento sem pagamento em que o cliente sai do acordo e volta à esteira como CPC A." (hoje está fixo em 6 —
    passe a gravar o valor escolhido).
- ON: a grade de dias **depois do vencimento** deixa de ser fixa (hoje D+1 a D+5): botão "+ dia" para incluir D+N
  e "×" para remover. Só permite dias **depois da carência e antes do retorno ao estoque**
  (carência < N < dias_para_estoque); colunas fora dessa faixa aparecem em cinza com o aviso "fora da janela da
  quebra — não será acionado". Grava em `definicao.quebra.passos` (chaves "1", "3", "8"…). Texto: "Dias depois do
  vencimento da parcela sem pagamento."
- OFF: grade recolhida/cinza com "Quebra desligada neste segmento: acordo quebrado não recebe ação e volta ao
  estoque como CPC A no prazo acima."

No painel **Como vai funcionar**, mostre "Preventivo: desligado" / "Quebra: desligada (volta ao estoque em N
dias)" quando for o caso, e a carência quando > 0 ("Quebra a partir do D+X").

Na **Lista do dia → Por que hoje**, o motivo novo `quebra_desligada` já vem pronto ("acordo quebrado, mas a quebra
está desligada na estratégia deste segmento").

## 2. Replicar estratégia (copiar de outro credor ou segmento)

No cabeçalho do bloco **Estratégia** (ao lado de "+ Nova" e "Exportar"), botão **Replicar de…**. Abre um modal:

1. **De onde copiar** (lista agrupada, com busca):
   - **Estratégias da empresa** — todas as linhas de `estrategias` (nome).
   - **Segmentos de outro credor** — escolha o credor (lista de `credores`) e o segmento (`clusters` em uso naquela
     carteira, via `segmentos_carteira`); a origem é a `estrategia_id` desse segmento.
   - **Estratégia padrão de um credor** — `credores.estrategia_id` de cada credor.
   Não liste a própria estratégia em edição.
2. **O que copiar** (checkboxes, todos marcados por padrão): Cliente novo (`localizacao`), CPC A/B (`cpc`),
   Não CPC (`giro`), Acordo — preventivo (`preventivo`), Acordo — quebra (`quebra`), Prioridade dos telefones
   (`prioridade_contatos`), WhatsApp só marcados (`whatsapp`).
3. **Personas**: se a origem tiver raias de personas (ações com `personas: [ids]`) e o destino for de outro credor,
   avise: "As raias de personas da origem são de outro credor e não serão copiadas — o público geral vem completo."
   e remova das ações copiadas as que têm `personas` com ids que não existem no credor de destino.
4. Botão **Replicar**: substitui no editor as partes marcadas pela cópia da origem (deep copy de
   `definicao[<parte>]`), **sem salvar** — o usuário revisa e clica em **Salvar** (mantém o fluxo atual de salvar
   e reenquadrar). Mostre um aviso no topo do editor: "Copiado de <origem>. Revise e salve para valer."
5. Se a estratégia atual for usada por outros segmentos/credores, o salvar já avisa como hoje (quem usa a mesma
   estratégia muda junto). Ofereça no modal a opção **"Criar como nova estratégia"** (cria uma linha nova em
   `estrategias` com nome "<nome da origem> (cópia)" e vincula ao segmento atual) para não afetar os outros.

## 3. Geral
- Português do Brasil; erros de consulta com o módulo de detalhe de erro existente.
- Nada disso precisa de mudança no banco.
