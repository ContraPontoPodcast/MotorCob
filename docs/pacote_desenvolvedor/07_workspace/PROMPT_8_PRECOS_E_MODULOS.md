# Prompt Horizons — Workspace 8: preços por produto (flat ou escalonado) e Orquestração opcional

Rode depois do SQL 12 (`12_precos_produtos.sql`). Substitui o card "Modelo" e o "Alterar modelo" da aba
Empresa › Faturamento (prompt 2) e a regra "Orquestração não desliga".

```text
Ajustes em Empresa › Módulos e Empresa › Faturamento. Não mude tabelas, views ou políticas. Equipe que edita =
admin da equipe MotorCob (perfis.equipe e papel 'admin'); o banco recusa os demais.

1. MÓDULOS: a Orquestração liga e desliga como os outros módulos (interruptor só para a equipe; upsert em
   empresa_modulos com modulo 'orquestracao' e ativo). Ao desligar, confirme: "Com a Orquestração desligada, o
   MotorCob não roda a rotina do dia desta empresa e a mensalidade da Orquestração sai da fatura." Remova qualquer
   texto ou trava "Orquestração não desliga". Cliente vê o selo Ativo/Desligado, sem interruptor.

2. FATURAMENTO › "PREÇOS" (substitui o card "Modelo" e o botão "Alterar modelo"):
   Itens: from('cobranca_itens').select('*').is('preco_de', null).eq('ativo', true).order('ordem').
   Preços: from('precos_empresa').select('*, precos_faixas(*)').eq('empresa_id', empresa)
   .order('vigente_desde', {ascending:false}). Para cada item, o preço vigente = o de maior vigente_desde até o mês
   atual (se todos forem futuros, o mais antigo).
   Agrupe por produto (orquestracao "Orquestração", sms "SMS", email "E-mail", rcs "RCS", whatsapp "WhatsApp";
   produto desconhecido: o próprio nome do item). Uma linha por item: nome · modelo (flat "Preço único", faixa
   "Tabela por faixa", progressivo "Tabela progressiva", mensalidade "Mensalidade") · resumo do preço
   ("R$ 0,065 por mensagem"; faixas "até 10.000: R$ 0,070 · acima: R$ 0,060"; "R$ 4.900,00/mês") · mínimo
   ("mínimo R$ 1.000,00" quando > 0) · "desde {mês/ano}". Sem preço: "Sem preço cadastrado" em laranja.
   Abaixo de SMS, em 13px #6E6E73: "Respostas do cliente são cobradas pelo preço do SMS e somam no volume."
   Abaixo de RCS: "Agente conversacional: quando o cliente responde, o envio vira sessão Conversacional e por 24 h
   não há cobrança extra."
   Equipe: botão "Editar preço" em cada linha e "Histórico" (lista das vigências do item, mais recente primeiro).

3. MODAL "EDITAR PREÇO" (só equipe): título = nome do item.
   - Segmentado: Preço único · Tabela por faixa · Tabela progressiva · Mensalidade.
   - Preço único: "Preço por {unidade} (R$)", até 5 casas. Mensalidade: "Valor por mês (R$)".
   - Faixa/progressiva: tabela editável de faixas com "Até (quantidade)" e "Preço (R$)"; a última linha é fixa
     "Acima de {limite anterior}" (sem campo de limite). Botões "Adicionar faixa" e remover (mínimo 2 faixas).
     Limites crescentes. Explique abaixo, conforme o modelo:
     faixa: "O volume do mês escolhe a faixa e esse preço vale para todas as unidades."
     progressiva: "Cada faixa cobra o seu preço só nas unidades dentro dela."
     Prévia ao vivo: campo "Simular volume" e o valor calculado com as regras acima.
   - "Mínimo mensal (R$)" opcional (não aparece em Mensalidade).
   - "Vale a partir de": seletor de mês (padrão: mês atual).
   - Salvar: supabase.rpc('salvar_preco', {empresa, item, modelo: 'flat'|'faixa'|'progressivo'|'mensalidade',
     preco (flat/mensalidade, senão null), minimo, faixas: [{ate: número ou null na última, preco}] (só nas
     tabelas, senão null), vigente_desde: 'AAAA-MM-01'}). Mostre o erro do banco em texto. Sucesso: "Preço salvo.
     Vale a partir de {mês/ano} e fica na auditoria."

4. KPIs do topo e "Consumo do mês" continuam iguais, mas com a prévia: supabase.rpc('previa_fatura', {empresa,
   competencia}). O primeiro KPI vira "Orquestração" com a soma das linhas 'orquestracao' e 'orquestracao_minimo'
   (sem linha: "—" e legenda "sem Orquestração neste mês"). Consumo: linha sms_resposta "SMS · respostas".

Valores em reais (R$ 1.234,56; preços unitários com até 5 casas). Sem rolagem lateral em 1440, 1024 e 390px.
Foco visível; Esc fecha o modal.
```
