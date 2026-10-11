# Prompt Horizons — Workspace 4/5: Suporte (cliente) e Arquivo ou API nos credores

Rode depois do 3/5. Referência visual: protótipo do Workspace, Suporte.

```text
Crie /suporte no Workspace (mesma barra do topo) e ajuste a tela Credores. Não mude tabelas, views ou políticas.

LISTA (/suporte): título "Suporte", contexto "Resposta em até 1 dia útil · prioridade alta em até 4 horas úteis".
Botão principal "Abrir chamado" (/suporte/novo). Segmentado: Abertos (situacao ≠ resolvido) · Resolvidos · Todos.
from('chamados').select('*').eq('empresa_id', empresa).order('atualizado_em', {ascending:false}).
Linha: protocolo (MC-2026-000142, tabular-nums, 13px cinza), assunto 15px 600, motivo + "atualizado {há quanto
tempo}", selo da situação: aberto "Aberto" cinza · em_atendimento "Em atendimento" azul #0A60D0 sobre
rgba(10,96,208,.1) · aguardando_cliente "Aguardando você" laranja · resolvido "Resolvido" verde. Prioridade alta:
selo "Alta". Vazio: "Nenhum chamado por aqui. Precisa de ajuda? Abra um chamado."

NOVO (/suporte/novo, aceita ?motivo=&assunto= para vir preenchido)
- Motivo* (select): acesso "Acesso e login" · lista_do_dia "Lista do dia e orquestração" · arquivos "Envio de
  arquivos e cargas" · mensageria "Mensageria" · faturamento "Faturamento" · integracao "Integração e API" ·
  sugestao "Sugestão de melhoria" · outro "Outro". Com "Outro", aparece "Qual é o motivo?"* (2 a 80 caracteres).
- Assunto* (3 a 120), Prioridade (segmentado Normal / Alta, com a legenda "Alta: a operação parou."),
  Descrição* (mínimo 10 caracteres, até 10.000), Anexos (até 5 arquivos de 10 MB: CSV, TXT, PDF, JPG, PNG, ZIP,
  XLS, XLSX; arrastar e soltar ou escolher; lista com nome, tamanho e remover).
- Erros na própria tela, em vermelho, um por campo: "Escolha o motivo.", "Escreva qual é o motivo.", "Escreva o
  assunto.", "Conte o que está acontecendo (pelo menos uma frase).", "Arquivo acima de 10 MB." etc.
- Enviar, nesta ordem:
  1. insert em chamados {empresa_id, motivo, motivo_outro, assunto, prioridade} com .select('id, protocolo').single()
     (aberto_por e situacao o banco preenche);
  2. sobe cada anexo para storage.from('chamados').upload(`${empresa}/${id}/${Date.now()}-${nomeSeguro}`);
  3. insert em chamado_mensagens {chamado_id: id, tipo: 'cliente', texto: descrição, anexos: [{caminho, nome,
     tamanho}]} (empresa_id o banco preenche).
  Sucesso: tela de confirmação com ícone CheckCircle verde, "Chamado aberto", o protocolo grande e "Você recebe a
  resposta aqui e por e-mail." + botão "Ver chamado".

DETALHE (/suporte/{id}): cabeçalho com assunto, protocolo · motivo · aberto por {nome} em {data}, selo da
situação. Conversa em balões: cliente à direita (#F5F5F7), equipe à esquerda (branco com sombra, "Suporte
MotorCob"); anexos como pílulas com ícone Paperclip que abrem por createSignedUrl(caminho, 300). Mensagens de
from('chamado_mensagens').select('*').eq('chamado_id', id).order('criado_em') (nota interna nunca chega ao cliente:
o banco filtra). Resposta: textarea + anexos (mesmas regras) + "Enviar" (insert tipo 'cliente'; responder um
chamado resolvido o reabre sozinho). Botão secundário "Marcar como resolvido" → rpc('resolver_chamado', {cid: id})
(só se não estiver resolvido). Atualize a conversa a cada 30 s com a aba visível ou por realtime em
chamado_mensagens filtrado pelo chamado.

CREDORES: em cada credor (lista e edição), novo campo "Como a carga chega" com segmentado Arquivo / API
(coluna credores.entrada_carga: 'arquivo' ou 'api'; quem tem editar_credores muda, os demais só veem).
- Arquivo: legenda "Envie pelo site, em Enviar arquivos. CSV, TXT ou XLSX."
- API: legenda "O sistema do credor manda direto pela API, com token. Mesmo relatório do arquivo." e aviso
  #F5F5F7: "A API está em preparação. Até lá, continue enviando por arquivo." (não bloqueia o envio por arquivo).
Na lista de credores, selo "Arquivo" ou "API" ao lado do nome.

Sem rolagem lateral em 1440, 1024 e 390px. Foco visível; Esc fecha modais.
```
