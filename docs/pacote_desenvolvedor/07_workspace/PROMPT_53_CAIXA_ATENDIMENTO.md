# Prompt Horizons — 53: Caixa de atendimento única (substitui a aba Respostas do prompt 13)

Rode depois do SQL 36 e dos prompts 49 e 50. Protótipo aprovado em 15/10/2026:
`docs/homologacao/radar-atendimento-prototipo.html` (tela "Caixa de atendimento").

```text
Plataforma do cliente (motorcob.online). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Onde fica
Mensageria › "Caixa de atendimento" (/mensageria/atendimento), uma só para SMS, RCS e WhatsApp. As antigas
/mensageria/{canal}/respostas levam para /mensageria/atendimento?canal={canal}. Selo com o total de nao_lidas no
menu, como hoje. Só para quem tem enviar_mensagens; os outros veem a tela travada com "Só quem pode enviar
mensagens atende as conversas". CPF e nome do cliente nunca aparecem: só destino_mascara e id_cliente.

## 2. Fila (coluna da esquerda, 320 px)
Abas com contagem: Abertas (situacao 'aberta') · Sem responsável (aberta e responsavel nulo) · Minhas (responsavel
= eu, não resolvida) · Aguardando cliente (situacao 'aguardando'). Filtros: canal, classe e busca por id_cliente.
Ordem: classe cpc_negocio e alega_pagamento primeiro, depois espera_desde mais antiga, depois ultima_em.
Item: máscara (negrito, bolinha se nao_lidas > 0), etiqueta do canal, hora da última mensagem; etiqueta da classe
com a confiança em %, "esperando N min" (de espera_desde) e, à direita, "Nova" (sem responsável), "com você" ou o
primeiro nome de quem atende; última mensagem em uma linha. Cor da espera: sem meta (mensageria_config.
meta_resposta_min nulo), sem cor; com meta, âmbar acima dela e vermelho acima do dobro.
Vazio: "Nenhuma conversa nesta fila."

## 3. Conversa (coluna do meio)
- Topo: máscara, canal, classe; "ID {id_cliente} · {campanha} · {situação}" (Nova, Em atendimento, Aguardando
  cliente, Resolvida). À direita: "Assumir" (sem responsável) ou "Com {nome}"; botão "Mais" (Transferir para
  colega · Corrigir a classe · Marcar "Aguardando cliente") e "Resolver"/"Reabrir".
  rpcs: atualizar_conversa(id, 'assumir' | 'resolver' | 'reabrir' | 'aguardando' | 'lida' | 'reclassificar',
  classe) e transferir_conversa(id, colega, nota). Ao abrir: atualizar_conversa(id, 'lida').
- Transferir: lista dos colegas da empresa que atendem (enviar_mensagens), menos você, e nota opcional.
- Linha do tempo única, por hora: mensagens (mensageria_conversa_mensagens; cliente à esquerda em cinza, nossas à
  direita na cor clara da área, com "Na fila / Enviada / Não enviada: {motivo}" e quem respondeu), notas internas
  (mensageria_conversa_notas, faixa amarela tracejada "Nota interna") e eventos (mensageria_conversa_eventos, linha
  cinza centralizada: "Você assumiu", "Transferida para Bruno", "Classe corrigida: Judicial → CPC",
  "Resolvida por Rita"). Na entrada, "Radar: {justificativa}".
- Responder: abas "Responder ao cliente" e "Nota interna".
  · Respostas rápidas acima do texto (mensageria_respostas_rapidas da empresa; as da classe da conversa primeiro,
    até 4 e "Mais"). Sem nenhuma: "Sem respostas rápidas. Criar em Configurar" (link só para Admin e Planejamento).
  · Rodapé: preço do canal ("Sai como SMS, no preço do SMS (R$ …)"; RCS com sessão aberta: "Sessão aberta até
    HH:MM: cobrada como sessão"), contador 160 no SMS e 1.000 nos outros, botão "Enviar" →
    responder_conversa(id, texto). A conversa vai para Aguardando cliente sozinha.
  · Nota interna: fundo amarelo, "Só a equipe da empresa vê. Não vai para o cliente." → anotar_conversa(id, texto).

## 4. Painel do cliente (coluna da direita, some abaixo de 1180 px)
ID, número mascarado, campanha, canal (e a sessão RCS). "Outras conversas deste cliente": as conversas da mesma
empresa com o mesmo id_cliente em outros canais (canal, data, classe), clicáveis. "Classe pelo Radar" com a
confiança e a origem (IA ou regras).

## 5. Celular
Abaixo de 760 px: só a fila; tocar abre a conversa em tela cheia com "‹ Voltar".
Atualize a fila e a conversa aberta a cada 15 s e ao voltar para a aba.

Confira em 1440 e 390 px, claro e escuro.
```
