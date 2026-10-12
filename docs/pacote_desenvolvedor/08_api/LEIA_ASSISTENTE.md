# Assistente MotorCob: o que publicar

Faça depois do SQL 17 (`17_funil_assistente.sql`). Depois cole o prompt 17 no Horizons.

## 1. Chave da IA nos Secrets do Supabase

1. Em **console.anthropic.com › Settings › API Keys**, crie uma chave só para o Assistente (nome
   "MotorCob Assistente"). Pode definir um limite de gasto mensal lá mesmo. Não cole a chave em chat, e-mail,
   no site nem no código.
2. Supabase › **Edge Functions › Secrets** › **Add new secret**: nome `ANTHROPIC_API_KEY`, valor = a chave. Salve.
   (`SITE_URL` e `ORIGENS_PERMITIDAS` já existem por causa da função de usuários; o Assistente usa as mesmas.)

Sem a chave, o Assistente funciona, mas sempre responde "Ainda não sei responder isso" com o botão Abrir chamado.

## 2. Função `assistente`

1. Supabase › Edge Functions › **Deploy a new function** › **Via Editor** › nome **`assistente`**.
2. Apague o exemplo e cole o arquivo `MotorCob_funcao_assistente.ts` inteiro (um arquivo só, sem chave dentro).
3. Deixe **Verify JWT LIGADO** (só quem está logado pergunta). **Deploy**.
4. Teste no site, depois do prompt 17: no Início do Workspace, digite "como crio uma campanha?" e Enter.

## Como funciona

- Responde com a base de conhecimento da plataforma (telas, passo a passo, status de envio, permissões, LGPD),
  usando o Claude com esforço baixo. A base fica em cache, por isso cada pergunta custa pouco.
- Antes de qualquer coisa, CPF, CNPJ, telefone, e-mail e números longos da pergunta viram marcadores. O
  Assistente não vê carteira, clientes, envios nem faturas; para casos específicos, indica abrir chamado.
- O botão da resposta só pode levar a telas de uma lista fechada (a IA não inventa endereço).
- Limite de 30 perguntas por hora por usuário. Cada pergunta fica 90 dias em `assistente_perguntas`.
- Console › Atendimento › Assistente mostra o que ficou sem resposta ou recebeu 👎: é a lista do que falta na base.
  Para completar a base, peça a atualização do arquivo `conhecimento.ts` (vem num pacote novo) e cole a função de novo.
