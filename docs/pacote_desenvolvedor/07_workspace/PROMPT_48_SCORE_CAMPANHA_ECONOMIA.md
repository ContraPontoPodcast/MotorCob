# Prompt Horizons — 48: Campanha com Score e Economia do Score (bloco 6, plataforma do cliente)

Rode depois do SQL 33 e do prompt 47. Protótipo: `docs/homologacao/bloco6-qualidade-score-prototipo.html`.

```text
Plataforma do cliente (motorcob.online). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Mensageria › Nova campanha › Confirmar envio
Só quando empresa_score da empresa estiver ativo: cartão "Score de Entrega" com (i) ("Probabilidade de entrega
de cada número, pelo histórico da Mensageria") e chave ligada por padrão.
"O que enviar": caixas de marcar Todos · Alto · Médio · Baixo · Sem histórico (o "Sem histórico" com (i):
"Número que ainda não passou pela Mensageria: o Score não tem como classificar"). Padrão: Alto, Médio e Sem
histórico. Todos marca/desmarca as quatro; desmarcar uma desmarca Todos. Nenhuma marcada: aviso vermelho e
"Agendar envio" desabilitado. Grava mensageria_campanhas.score_faixas ('alto','medio','baixo','sem');
chave desligada = score_faixas vazio.
Texto abaixo: "Os números fora das faixas não são enviados e voltam no retorno com o nome da faixa."
(A divisão do mailing por faixa e a economia aparecem depois do envio, em Economia do Score.)

## 2. Mensageria › Economia do Score (item novo no menu: "Quanto o Score fez você economizar")
Filtros: "De" e "Até" (datas; padrão: os últimos 6 meses) e "Campanha" (Todas do período + as campanhas).
Fonte: rpc economia_score(empresa, de, ate) → campanha_id, nome, dia, analisados, represados, enviados,
preco_sms, total_sem, total_com, economia, custo_unitario.
- Cartão único, duas colunas:
  · "Economia líquida" (soma de economia; verde, vermelho se negativa) e a frase "Cada R$ 1,00 pago no Score
    evitou R$ X em SMS para números de baixa entrega" (X = represados × preco_sms ÷ (total_com − enviados ×
    preco_sms)).
  · "Custo unitário efetivo" = soma(total_com) ÷ soma(analisados), 4 casas, "contra R$ y do SMS padrão ·
    economia de z%".
  · Linha da conta embaixo: "18.420 carregados · 2.210 represados · 16.210 enviados · total pago R$ … ÷ 18.420 =
    R$ … por número · sem o Score seriam R$ …".
- Gráfico de barras da economia líquida por mês do período.
- "Prova do Score": rpc controle_score(empresa, de, ate) → barra por faixa com a taxa de entrega real do grupo
  de controle.
- Tabela por campanha (Campanha, Data, Mailing, Represados, Sem o Score, Com o Score, Economia líquida); clicar
  numa linha filtra o cartão para aquela campanha.
Valores em R$ (2 casas; unitários com 4). Nenhuma simulação: só o que foi faturado.

Confira em 1440 e 390 px, claro e escuro.
```
