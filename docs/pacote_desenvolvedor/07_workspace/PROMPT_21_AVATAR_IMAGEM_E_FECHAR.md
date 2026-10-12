# Prompt Horizons — Workspace 21: a imagem certa do avatar, o botão de fechar e o balão de 7 segundos

Conferido no site publicado: o arquivo `/assistente-motorcob.jpg` é um robô gerado pelo Horizons, não o avatar
aprovado. A imagem passa a ficar no Storage do Supabase (endereço fixo) e o site só aponta para ela.

**Antes de colar (uma vez):** Supabase › **Storage** › **New bucket** › nome `publico` › ligue **Public bucket** ›
Create. Abra o bucket › **Upload file** › envie `assistente-motorcob.webp` (pasta 07_workspace do pacote).
Teste no navegador: https://jxwppkrkuckfwmphqjva.supabase.co/storage/v1/object/public/publico/assistente-motorcob.webp
deve mostrar o avatar. (Esse bucket é só para imagens públicas do site; nunca coloque arquivo de cliente nele.)

```text
Três correções no avatar do Assistente MotorCob. Não mude a gaveta de conversa, a função assistente, consultas
nem tabelas.

1. IMAGEM: em TODOS os lugares onde o avatar aparece (botão fixo, topo da gaveta, card de resposta do campo
   "O que você quer fazer?", menu lateral e Workspace), use EXATAMENTE este endereço como src:
   https://jxwppkrkuckfwmphqjva.supabase.co/storage/v1/object/public/publico/assistente-motorcob.webp
   Guarde numa constante só (AVATAR_ASSISTENTE) e use em todos os lugares. APAGUE do projeto o arquivo
   /assistente-motorcob.jpg (o robô) e qualquer imagem gerada para o avatar. Não gere, não troque e não recorte a
   imagem: object-fit cover, redonda, como já está.

2. BOTÃO DE FECHAR no avatar fixo: círculo 22px no canto superior esquerdo da foto (sobrepondo a borda), fundo
   #1D1D1F, "×" branco 13px, borda branca 2px, sombra leve; aria-label e title "Esconder o assistente". Fica
   sempre visível (no celular não existe passar o mouse). Clique: o avatar e o balão somem, sem abrir a gaveta,
   e aparece um aviso no rodapé por 6 s: "Assistente escondido. Para trazer de volta: menu do usuário › Mostrar
   o Assistente. As perguntas no campo do Início continuam funcionando."
3. LEMBRAR A ESCOLHA: guarde no navegador (localStorage "mc-assistente-oculto" = "1"/"0", com try/catch) e
   aplique em todas as telas e depois de recarregar. Escondido, o campo "O que você quer fazer?" continua
   respondendo e "Continuar a conversa" continua abrindo a gaveta (o avatar fixo é que não aparece).
4. MENU DO USUÁRIO (o do avatar com as iniciais no topo do Workspace e o do rodapé do menu lateral): item novo
   logo abaixo de "Minha conta": "Esconder o Assistente" (ícone EyeOff) quando ele está visível, ou "Mostrar o
   Assistente" (ícone Eye) quando está escondido. Mostrar: o avatar volta e o aviso "Assistente de volta no
   canto da tela.".
5. Com a gaveta aberta, o avatar fixo e o "×" ficam escondidos; ao fechar a gaveta, voltam (se não estiverem
   escondidos pelo usuário).
6. BALÃO "Dúvida? Fala comigo!" COM TEMPORIZADOR: aparece quando o avatar surge (ao carregar a tela, ao fechar a
   gaveta e ao "Mostrar o Assistente") e some sozinho depois de 7 segundos, com fade de 0,4 s (sem animação se o
   sistema pedir menos movimento); o avatar continua. Troca de tela dentro do sistema não faz o balão voltar.
   Isto substitui a regra antiga "o balão some depois da primeira conversa".

Confira em 1440 e 390px: a foto do avatar aprovado (homem de barba e óculos), o "×" sem cobrir o rosto, e a
escolha lembrada depois de recarregar.
```
