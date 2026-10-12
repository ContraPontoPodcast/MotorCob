# Prompt Horizons — Workspace 28: suporte mostra quem está atendendo

Rode depois do **SQL 20** (`01_banco/20_suporte_nomes.sql`). O SQL 20 já corrige o erro "Não foi possível concluir
a operação" ao abrir chamado e ao responder pelo Console: o Console mandava `autor_nome` e o banco não tinha esse
campo. Agora o banco tem e preenche sozinho. Este prompt só mostra os nomes.

```text
Suporte: mostrar quem está atendendo e quem escreveu cada mensagem. Não mude tabelas nem políticas.

1. CHAMADO DO CLIENTE (/suporte/:id e a lista "Meus chamados"): quando situacao = 'em_atendimento' e
   chamados.responsavel_nome estiver preenchido, o selo vira "Em atendimento · com {responsavel_nome}"
   (ex.: "Em atendimento · com Ana S."). Na lista, a mesma informação embaixo do assunto, 13px cinza.
   'aguardando_cliente' → "Aguardando você"; 'resolvido' → "Resolvido"; 'aberto' → "Aberto".

2. CONVERSA (cliente e Console): em cada mensagem, acima do texto, o nome em chamado_mensagens.autor_nome
   (13px 600) e a hora. Mensagens da equipe: "{autor_nome} · Suporte MotorCX". Do cliente: só o nome. Nota
   interna (só a equipe vê): "{autor_nome} · nota interna", fundo amarelo claro. Se autor_nome vier vazio,
   use "Suporte MotorCX" (equipe) ou "Você" (o próprio usuário).

3. ENVIO: não mande mais o campo autor_nome no insert de chamado_mensagens (o banco preenche e ignora o que vier).
   Mensagem só com anexo, sem texto, é aceita: mande texto null. Ao assumir um chamado no Console, recarregue
   o chamado para mostrar o nome de quem assumiu.

4. ERROS: quando o insert ou o update do suporte falhar, mostre a mensagem do banco (error.message) abaixo do
   botão, além do aviso geral, para sabermos o que aconteceu.

Confira: cliente abre chamado com descrição (a mensagem aparece na conversa); a equipe assume e responde pelo
Console; o cliente vê "Em atendimento · com {nome}" e a resposta com o nome de quem respondeu.
```
