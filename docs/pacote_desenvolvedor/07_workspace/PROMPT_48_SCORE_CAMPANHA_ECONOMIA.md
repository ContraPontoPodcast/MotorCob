# Prompt Horizons — 48: Campanha com Score e Economia do Score (bloco 6, plataforma do cliente)

Rode depois do SQL 33 e do prompt 47. Substitui, no passo de confirmar da campanha, o que o prompt 11 dizia sobre agendar. Protótipo: `docs/homologacao/bloco6-qualidade-score-prototipo.html`.

```text
Plataforma do cliente (motorcob.online). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Mensageria › Nova campanha: prévia do Score antes de agendar
Com o Score contratado (empresa_score ativo), rpc confirmar_layout devolve 'calculando_previa' em vez de 'pronta'.
- Situação 'calculando_previa': tela "Calculando a prévia do Score de Entrega…" com indicador de progresso e o
  texto "Leva alguns minutos. Você pode sair: a campanha fica salva." Recarregue a campanha a cada 15 s.
- Quando ficar 'pronta' com score_previa preenchido (faixas {alto, medio, baixo, sem}, analisados, preco_sms,
  preco_score, cobranca), mostre no passo de confirmar o cartão "Score de Entrega" com (i) e a chave ligada:
  · barra dividida pelas 4 faixas e um quadro por faixa (quantidade e % da lista);
  · "O que enviar": caixas Todos · Alto · Médio · Baixo · Sem histórico ("Sem histórico" com (i): "Número que
    ainda não passou pela Mensageria: o Score não tem como classificar"). Padrão: Alto, Médio e Sem histórico.
    Todos marca/desmarca as quatro; desmarcar uma desmarca Todos. Nenhuma marcada: aviso vermelho e "Agendar
    envio" desabilitado;
  · prévia que muda na hora: "N números serão enviados · M não serão enviados (Baixo…)" e o **custo unitário
    efetivo desta campanha** = (enviados × preco_sms + Score) ÷ analisados, onde Score = analisados ×
    preco_score (cobranca 'analisado') ou não enviados × preco_score ('represado'); "contra R$ preco_sms do SMS
    padrão · total R$ X em vez de R$ Y". Sem preço cadastrado: mostre só as quantidades.
- Agendar: rpc agendar_campanha(campanha, quando, faixas) com faixas = ['alto','medio','baixo','sem'] marcadas;
  chave do Score desligada = faixas null (todos saem, sem Score).
Campanha pela API não passa por aqui: segue direto e o resultado aparece em Economia do Score.

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
- Tabela por campanha (Campanha, Data, Lista, Represados, Sem o Score, Com o Score, Economia líquida); clicar
  numa linha filtra o cartão para aquela campanha.
Valores em R$ (2 casas; unitários com 4). Nenhuma simulação: só o que foi faturado.

VITRINE (empresa sem empresa_score ativo): a mesma página, sem o seletor de campanha, mostra só dados reais.
- rpc vitrine_score(empresa, de, ate) → enviados, nao_entregues, valor_nao_entregues, preco_medio.
- Cartão: "SMS que não chegaram · {de} a {ate}" = nao_entregues, "{x}% dos {enviados} SMS enviados no período";
  "Pago por esses SMS" = valor_nao_entregues, "{nao_entregues} × {preco_medio}, o preço do SMS no seu contrato".
  Rodapé: "Números reais das suas campanhas, pelo retorno das operadoras (DLR). Nada aqui é estimativa."
- Dois cartões de texto: "Como o Score de Entrega reduz esse valor" (3 passos) e "O que aparece aqui com o
  Score" (economia líquida, custo unitário efetivo, grupo de controle) com o botão "Pedir proposta do Score":
  insere em chamados (motivo 'mensageria', assunto 'Proposta do Score de Entrega') e mostra "Pedido enviado ao
  time comercial. Ele entra em contato pelo e-mail da empresa."
- Sem SMS no período: "Nenhum SMS enviado neste período." Nunca mostrar economia estimada.

Confira em 1440 e 390 px, claro e escuro.
```
