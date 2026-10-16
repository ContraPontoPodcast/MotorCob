# Prompt Horizons — 66: a gaveta do Assistente (substitui os itens 2 a 5 do prompt 17 e o 21)

Rode depois do SQL 43 e da função `assistente` nova. Protótipo aprovado em 16/10/2026: `docs/homologacao/assistente-prototipo.html`
(telas "Conversa", "Quando não dá", "Passar para o Suporte" e "Minhas perguntas").

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Nome em todas as telas: "Assistente MotorCX" (troque qualquer
"Assistente MotorCob" e "Pergunte sobre o MotorCob" que sobrou).

## 1. Chamada (campo do Início e gaveta, a mesma conversa)
POST {SUPABASE_URL}/functions/v1/assistente com o token da sessão e { pergunta, origem, tela: rota atual, tela_nome:
o nome da tela como no menu ("Mensageria › Campanhas"), frente: a frente ativa, historico: últimas 8, stream: true }.
A resposta vem em eventos (text/event-stream; leia com fetch + getReader, não EventSource):
- "texto" { texto }: mostre o texto já escrito no balão, com um cursor piscando no fim (sem cursor com
  prefers-reduced-motion). Sem os três pontinhos depois do 1º evento.
- "fim" { id, respondida, texto, passos, acao, situacao, removeu }: troque pelo texto final, mostre os passos
  numerados e o botão da ação (mapa de ações do prompt 17; esconda se a pessoa não abre a tela).
Erros antes dos eventos: 429 "Muitas perguntas seguidas. Tente de novo em alguns minutos."; 401 volta para o login;
outro: o cartão "fora do ar" do item 3.

## 2. Gaveta
Cabeçalho: avatar, "Assistente MotorCX" / "Tira dúvidas sobre a plataforma", link "Minhas perguntas" e ×.
Logo abaixo: "Você está em" + pílula com tela_nome + pílula com o perfil e a frente.
Sem conversa ainda: rpc sugestoes_assistente(tela) → grupo "tela" sob "Nesta tela" e "frequentes" sob "Mais
perguntadas na sua empresa" (some se vier vazio). Clicar numa pílula pergunta na hora.
Pé: textarea "Pergunte sobre a plataforma" (Enter envia, Shift+Enter quebra linha) e o aviso "Não vê dados de
clientes. Não escreva CPF, telefone ou e-mail de clientes."

## 3. Quando não dá (pela situacao do "fim")
- sem_resposta: o texto devolvido + botão "Falar com o Suporte".
- fora_do_ar: cartão vermelho claro "O Assistente está fora do ar agora. Tente de novo em alguns minutos ou fale com
  o Suporte." (o texto vem pronto).
- teto: cartão neutro com o texto devolvido + "Falar com o Suporte".
- removeu = true: faixa âmbar acima da resposta "Tiramos um dado pessoal da sua pergunta antes de enviar. O
  Assistente não vê clientes."

## 4. Ajudou?
👍 / 👎 com aria-pressed. 👍 → rpc avaliar_resposta(id, 1) e "Obrigado!". 👎 → mostra "O que faltou?" com as pílulas
Não respondeu (nao_respondeu) · Está errado (errado) · Difícil de entender (dificil) · Não tenho essa tela
(sem_acesso) · Falar com o Suporte. Clicar num motivo → avaliar_resposta(id, -1, motivo) e "Obrigado! A equipe vê
este motivo." Sem motivo escolhido em 10 s, grava avaliar_resposta(id, -1).

## 5. Falar com o Suporte
POST na mesma função { acao: "chamado", pergunta, tela, tela_nome, historico, avaliacao: "👎 {motivo}" | null } →
{ motivo, assunto, conversa }. Abra /suporte/novo já preenchido: Motivo = motivo, Assunto = assunto, a caixa
"Conversa com o Assistente (anexada)" com a conversa (só leitura) e o checkbox "Anexar a conversa" marcado. Ao
enviar, o chamado leva assistente_pergunta_id = id da última resposta e, marcado o checkbox, a conversa vai como 1ª
mensagem. Nunca use a pergunta original digitada: só o que a função devolveu.

## 6. Minhas perguntas (/assistente/minhas, e o link da gaveta)
from('assistente_perguntas').select('id,pergunta,tela_nome,tela,criado_em,situacao,avaliacao,resposta,acao')
.eq('usuario_id', eu) dos últimos 90 dias. Colunas: Pergunta · Tela · Quando · Resultado (👍 · 👎 · "respondida" ·
"sem resposta" âmbar · "fora do ar" cinza). Abrir uma linha mostra a resposta e o botão da ação; "Perguntar de novo"
manda a mesma pergunta. No celular, cartões.

Confira em 1440, 1024 e 390 px, claro e escuro, só teclado e leitor de tela (a resposta nova é anunciada com
aria-live="polite" só no "fim").
```
