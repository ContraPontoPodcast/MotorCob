# Assistente MotorCX: o que publicar

> Atualizado pela revisão de UX (SQL 43, 16/10/2026): modelo Sonnet 5.5 com a resposta aparecendo enquanto é
> escrita, teto do mês em reais e Respostas da equipe pelo Console. Prompts 66 e 67.

Faça depois do SQL 17 (`17_funil_assistente.sql`). Depois cole o prompt 17 no Horizons.

## 1. Chave da IA nos Secrets do Supabase

1. Em **platform.claude.com** (antigo console.anthropic.com), coloque crédito em **Settings › Billing** e, em
   **Settings › API Keys**, crie uma chave só para o Assistente (nome
   "MotorCob Assistente"). Pode definir um limite de gasto mensal lá mesmo. Não cole a chave em chat, e-mail,
   no site nem no código.
2. Supabase › **Edge Functions › Secrets** › **Add new secret**: nome `ANTHROPIC_API_KEY`, valor = a chave. Salve.
   (`SITE_URL` e `ORIGENS_PERMITIDAS` já existem por causa da função de usuários; o Assistente usa as mesmas.)

Sem a chave, o Assistente responde "O Assistente está fora do ar agora" com o botão Falar com o Suporte (e isso não
entra na lista do que falta na base).

## 2. Função `assistente`

1. Supabase › Edge Functions › **Deploy a new function** › **Via Editor** › nome **`assistente`**.
2. Apague o exemplo e cole o arquivo `MotorCob_funcao_assistente.ts` inteiro (um arquivo só, sem chave dentro).
3. Deixe **Verify JWT LIGADO** (só quem está logado pergunta). **Deploy**.
4. Teste no site, depois do prompt 17: no Início do Workspace, digite "como crio uma campanha?" e Enter.

## Como funciona

- Responde com a base de conhecimento da plataforma (telas, passo a passo, status de envio, permissões, LGPD) e as
  Respostas da equipe, usando o Claude Sonnet 5.5 com esforço baixo e a resposta em partes (o site mostra enquanto
  chega). A base fica em cache de 1 hora, por isso cada pergunta custa pouco. Se o provedor recusar a pergunta por
  política, ele mesmo tenta outro modelo (fallback do servidor) e o custo estimado usa o preço do modelo que respondeu.
- Sabe perfil, frente, módulos contratados e a tela; só sugere telas que a pessoa abre.
- Custo: cada pergunta guarda os tokens e o custo estimado em dólar; o Console mostra o mês em reais pela cotação
  (PTAX do Banco Central, atualizada pelo motor; o Master pode digitar outra). Teto padrão: R$ 399,90 por mês. Com o
  teto atingido, só as Respostas da equipe e o Suporte até virar o mês; a equipe recebe aviso com 80% e 100%.
  Mantenha também um limite de gasto mensal no painel do provedor, um pouco acima do teto, como segunda trava.
- Antes de qualquer coisa, CPF, CNPJ, telefone, e-mail e números longos da pergunta viram marcadores. O
  Assistente não vê carteira, clientes, envios nem faturas; para casos específicos, indica abrir chamado.
- O botão da resposta só pode levar a telas de uma lista fechada (a IA não inventa endereço).
- Limite de 30 perguntas por hora por usuário. Cada pergunta fica 90 dias em `assistente_perguntas`.
- Console › Assistente: Painel (uso, acerto, custo, temas), Para resolver (sem resposta e 👎, perguntas parecidas
  juntas) e Respostas da equipe, que completam a base na hora, sem publicar a função. A cada pacote novo, as mais
  usadas passam para o `conhecimento.ts`.
