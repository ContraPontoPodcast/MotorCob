# Prompt Horizons — 70: Suporte do cliente com prazo de resposta e "Aguardando você"

Rode depois do SQL 44 e do motor na nuvem (fecha os chamados parados todo dia). Protótipo aprovado em 16/10/2026:
`docs/homologacao/workspace-prototipo.html` (tela "Suporte"). Complementa os prompts 4, 28 e 37.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Nada de CPF ou nome de devedor nos chamados.

## 1. Lista (/suporte)
from('chamados').select('id,protocolo,assunto,motivo,prioridade,situacao,responsavel_nome,ultima_de,ultima_em,
visto_cliente_em,criado_em,prazo_resposta') — prazo_resposta é uma coluna calculada do banco.
Ordem: primeiro "Aguardando você" (situacao = 'aguardando_cliente'), depois os abertos pela data, os resolvidos por
último. Botão "Abrir chamado" no cabeçalho (o formulário que já existe, /suporte/novo).
Colunas: Chamado (protocolo · assunto; pílula vermelha "Nova resposta" quando situacao <> 'resolvido', ultima_de = 'equipe' e
ultima_em > visto_cliente_em) · Motivo (em palavras) · Situação · Resposta até.
Situação: aberto "Aberto" · em_atendimento "Em atendimento · {responsavel_nome}" · aguardando_cliente "Aguardando
você" (âmbar) · resolvido "Resolvido" (verde).
Resposta até: prazo_resposta em "hoje 17:00", "amanhã 11:00" ou "seg 09:00"; vazio → "—". Para o cliente, NUNCA em
âmbar ou vermelho, mesmo se já passou (o atraso só aparece para a equipe, no Console).
Celular: cartão por chamado (protocolo e situação em cima; motivo e prazo embaixo).
A contagem de "Aguardando você" vai para o número ao lado de "Suporte" na barra do topo (prompt 68).

## 2. Conversa (/suporte/:id)
Linha do tempo no topo: Aberto {hora} → Em atendimento {hora} → Aguardando você → Resolvido, marcando a etapa atual.
Mensagens: cliente à direita, equipe à esquerda com "{autor_nome} · Suporte MotorCX · {hora}". Mensagem sem
autor_nome = "Suporte MotorCX" (é a do fechamento automático). Notas internas (tipo 'nota') nunca aparecem.
Ao abrir, marque como visto: rpc marcar_chamado_visto(id).
Rodapé: caixa de texto · "Anexar (até 5 · 10 MB)" · "Enviar" · "Marcar como resolvido" (confirmação simples).
Quando situacao = 'aguardando_cliente': faixa âmbar acima da caixa "O Suporte espera sua resposta. Sem resposta em
7 dias, o chamado fecha sozinho (você recebe um aviso 2 dias antes)."
Resolvido: a caixa continua; o texto acima dela diz "Responder reabre o chamado."

## 3. Para hoje e sino
O Início (prompt 68) já mostra "O Suporte espera sua resposta…" e "O Suporte respondeu…" pela rpc para_hoje; não
duplique. O aviso do 5º dia chega pelo sino ("O chamado {protocolo} fecha em 2 dias", link /suporte/{id}).

Confira em 1440 e 390 px, claro e escuro.
```
