# Prompt Horizons — Página comercial, login novo e rotas

Antes: passos 1 e 2 do pacote (painel do Supabase + SQL + mídia no bucket `site`). Cole no Horizons e publique.

---

```text
Crie a página comercial pública do MotorCob em "/" e um login novo em "/login". A plataforma não muda: só a página
inicial dela sai de "/" e vai para "/inicio".

ROTAS
- "/" página comercial (sem login). "/login" login novo. "/inicio" = a atual Visão da operação; o item "Início" do
  menu aponta para lá; depois do login vá para "/inicio" (ou para a página protegida que a pessoa tentou abrir).
- REMOVA a página "/cadastro" e todo link para ela; "/cadastro" redireciona para "/login". Não existe cadastro
  público: acesso só por convite.
- Usuário logado que abre "/" vê a página comercial com "Ir para a plataforma" no lugar de "Entrar".

IDENTIDADE
Fonte Geist (Google Fonts) e Geist Mono. Preto #050606/#0E1112, branco, cinzas #86898B/#5A5E60, linhas #E2E4E5.
Âmbar #E9A23B só como assinatura (nunca texto âmbar sobre branco). Logo em texto "MotorCob" + ponto final âmbar.
Minimalista, muito espaço, títulos enormes com letter-spacing negativo (-0.045em), botões em pílula.

HOME (de cima para baixo)
1. Barra fixa transparente: logo · Produto · Segurança · Contato · Entrar.
2. Seção preta, quase tela cheia: título gigante "Pare de / adivinhar." (ponto âmbar). Texto: "O MotorCob usa seus
   agentes de IA para decidir, para cada cliente da carteira, quem acionar, por qual canal e em qual telefone. Todo
   dia. E eles aprendem com cada ocorrência." Botões: "Agendar uma conversa" (branco, rola até o contato) e link
   sublinhado "Assista ao filme (4 min)" que abre modal com o vídeo MotorCob_video_completo.mp4 (com controles,
   não toca sozinho). Embaixo, linha em fonte mono, cinza, separada por linha fina: "100004817 → atraso recente →
   D+3 → WhatsApp → (11) 9••••-••17 → CPC · vira Hot" (último trecho em âmbar).
3. Fundo branco, três frases enormes, uma abaixo da outra, que ficam pretas ao chegar ao meio da tela (antes cinza
   claro), com o final em cinza que vira âmbar: "Sua operação ainda começa com PROCV." / "O telefone certo existe.
   Você só não sabe qual é." / "Resultado no fim do mês é tarde demais."
4. Centralizado: "APRESENTAMOS" (mono, pequeno) / "MotorCob." gigante / "Da carga à ação, com inteligência." e a
   imagem produto-esteira.jpg grande, cantos 14px, sombra suave; legenda "Orquestração: arraste canais para os
   dias de cada fase. Dados fictícios."
5. Faixa com linhas finas em cima e embaixo, três colunas: "Decide." / "Aprende." / "Prova." com textos curtos.
6. Três números gigantes: "1" contato por cliente em cada canal · "1" arquivo por canal, pronto para o disparo ·
   "0" (âmbar) planilhas no caminho.
7. "SEUS AGENTES" / "Quatro especialistas." + (cinza) "Trabalhando antes de você chegar." e 4 colunas numeradas em
   âmbar: 01 Ingestão, 02 Contato, 03 Analista, 04 Estrategista (textos do protótipo). Fecha com "A IA aprende.
   Você decide."
8. Fundo cinza muito claro: "O Analista sabe qual canal funciona para quem." + texto + imagem detalhe-persona.jpg.
9. Seção preta: "Dado de devedor não é planilha compartilhada." + (cinza) "Nunca foi." e 3 itens: Isolamento por
   empresa · Telas sem dado pessoal · Permissões e histórico.
10. "Mostre a sua carteira." + formulário: Nome*, Empresa, E-mail*, Telefone, Mensagem, caixa obrigatória
    "Concordo que o MotorCob use estes dados para retornar o meu contato.", honeypot escondido. Envio:
    supabase.from('contatos_site').insert({nome, empresa, email, telefone, mensagem, consentimento: true,
    origem: 'home'}) SEM .select(). Sucesso: "Recebemos. Retornamos em até 1 dia útil."
11. Rodapé: © 2026 MotorCob · Entrar · Contato · Privacidade (página /privacidade com texto simples sobre os dados
    do formulário e como pedir exclusão).
Imagens e vídeo em https://jxwppkrkuckfwmphqjva.supabase.co/storage/v1/object/public/site/ (produto-esteira.jpg,
detalhe-persona.jpg, MotorCob_video_completo.mp4; og-motorcob.jpg no Open Graph). Title: "MotorCob · Pare de
adivinhar."

LOGIN "/login" (fundo preto)
Topo: logo à esquerda, "Voltar ao site" à direita. Centro (largura 400px): "Entrar." gigante, "Use o e-mail do
convite que você recebeu.", campos E-mail e Senha escuros (botão "Mostrar"), "Manter conectado" e "Esqueci a senha",
botão branco "Continuar". signInWithPassword; erro sempre "E-mail ou senha incorretos.". Depois do login, se o
perfil for Admin: mfa.getAuthenticatorAssuranceLevel(); sem fator → cadastrar TOTP (QR code + código); com fator e
aal1 → tela "Só mais um passo." com 6 caixas de dígito → mfa.challenge + mfa.verify; só entra com aal2.
"Esqueci a senha" → resetPasswordForEmail com redirectTo https://motorcob.online/redefinir-senha; resposta sempre
"Se o e-mail estiver cadastrado, enviaremos um link para criar uma senha nova." Rodapé: "Acesso só por convite.
Sessão encerra após 30 minutos sem uso."

Sem rolagem lateral em celular; respeite prefers-reduced-motion.
```
