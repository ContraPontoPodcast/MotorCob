# Prompt Horizons — Workspace 13: Radar MotorCob e atendimento das respostas

Rode depois do SQL 15 (`15_radar_atendimento_links.sql`) e do prompt 11. É a aba "Respostas" de cada produto.

```text
Aba Respostas em /mensageria/{canal}/respostas (SMS, RCS e WhatsApp). Não mude tabelas, views ou políticas. Quem vê
e responde: permissão enviar_mensagens (o banco já esconde o texto dos demais). Nunca mostre telefone completo.

1. RADAR MOTORCOB (faixa no topo): ícone de radar + "Radar MotorCob lê cada resposta e mostra a intenção do
   cliente. O pedido de negócio pesa mais que o palavrão: “me manda o boleto FDP” é CPC Negócio." Cards por
   classe, clicáveis (filtram a lista), com contagem de from('radar_resumo').select('*').eq('empresa_id', empresa)
   .eq('canal', canal) no período (Hoje, 7 dias, 30 dias): cpc_negocio "CPC Negócio" #1F8A4C · cpc "CPC" #0A60D0 ·
   alega_pagamento "Alega pagamento" #7A4FB0 · judicial "Judicial" #B3261E · desconhece "Desconhece" #8E8E93 ·
   baixo_calao "Baixo calão" #A2552B. Mostre também "abertas".

2. CAIXA DE ENTRADA (duas colunas em 1440/1024; uma em 390 com voltar):
   Esquerda: from('mensageria_conversas').select('*').eq('empresa_id', empresa).eq('canal', canal)
   .order('ultima_em', {ascending:false}), 50 por página. Filtros: classes (pílulas, várias), Situação (Abertas |
   Resolvidas | Todas), "Só não lidas", busca por ID do cliente, campanha. Cada item: selo da classe (cor acima) +
   confiança em %, ID do cliente, destino mascarado, última mensagem (1 linha, do item mais recente de
   mensageria_conversa_mensagens), hora, bolinha azul com nao_lidas.
   Direita (conversa aberta): cabeçalho com ID, máscara, selo da classe e o menu Reclassificar (as 6 classes →
   rpc('atualizar_conversa', {conversa, acao:'reclassificar', classe})), Assumir, Resolver / Reabrir.
   Mensagens: from('mensageria_conversa_mensagens').select('*').eq('conversa_id', id).order('id'). Entrada à
   esquerda (cinza #F5F5F7) com a classe, "Por que: {justificativa}" em 12px #6E6E73 e "IA" ou "Regras"
   (origem_radar); saída à direita (#1D1D1F, texto branco) com o estado: pendente "Na fila" · enviada "Enviada" ·
   falhou "Não enviada: {motivo}". Ao abrir: rpc('atualizar_conversa', {conversa, acao:'lida'}).
   Caixa de resposta: textarea; no SMS contador "{n}/160"; botão "Enviar" → rpc('responder_conversa', {conversa,
   texto}); mostre o erro do banco em texto (ex.: "este contato pediu para não receber mais mensagens"). Legenda:
   "Sai pelo mesmo canal no horário de envio. Respostas de SMS são cobradas como SMS."
   Atualize a lista e a conversa aberta a cada 15 s com a aba visível.

3. RESPONDER UM GRUPO: com um filtro de classe ativo, botão "Responder a todos deste filtro" abre um modal com o
   número de conversas (até 200 abertas), a caixa de texto e a confirmação "Enviar para {n} clientes". Envie um
   rpc('responder_conversa') por conversa, em sequência, com barra de progresso e o resumo final (enviadas e
   recusadas, com o motivo).

4. Rodapé fixo da aba: "Os textos das respostas ficam guardados por 90 dias e depois são apagados. A classificação
   continua nos relatórios."

Sem rolagem lateral em 1440, 1024 e 390px. Foco visível; Esc fecha modais.
```
