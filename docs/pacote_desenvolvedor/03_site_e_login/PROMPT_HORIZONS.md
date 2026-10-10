# Prompt Horizons — Site público, login e rotas
Rode depois das pastas 01 e 02, antes da 04. Cole no Horizons e publique (imagem de apoio: `imagens/site_inteiro.png`):

```text
Crie o site público em "/" e o login novo em "/login", na linha Apple. A plataforma atual sai de "/" e vai para
"/inicio". "/cadastro" deixa de existir: redirecione para "/login". Não mude tabelas, views ou políticas.

ESTILO (vale para site e login)
- Fonte do sistema, sem carregar arquivo: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui.
- Cores: texto #1D1D1F, secundário #6E6E73, fundo #FFFFFF e #F5F5F7, linhas #E5E5EA, campos com borda #D2D2D7.
- Botão principal: pílula #1D1D1F, texto branco. Secundário: pílula #F2F2F7, texto #1D1D1F.
- Títulos peso 700, letter-spacing -0.035em. Sem itálico, sem caixa-alta, sem gradiente. Números com tabular-nums.
- Logo: símbolo Rotor (SVG da pasta 04) + "MotorCob" 600. Champanhe #C9A35A só dentro do símbolo.

CABEÇALHO DO SITE (fixo, escuro)
Fundo rgba(22,22,23,.88) com backdrop-filter saturate(180%) blur(20px), altura 52px. Símbolo versão escura +
"MotorCob" branco. À direita, links 13px brancos (80% de opacidade): Produto, Lista do dia, Personas, Agentes,
Segurança, Contato, e botão "Entrar" (pílula rgba(255,255,255,.14)). Cada link rola suave até a seção:
#produto, #lista-site, #personas-site, #agentes, #seguranca, #contato. Seções com scroll-margin-top 64px (92px
no celular). No celular os links vão para uma segunda linha com rolagem lateral só nela.
Logado: "Entrar" vira "Ir para a plataforma" (/inicio).

SEÇÕES (fundo alternando branco e #F5F5F7)
1. Abertura centralizada: "Inteligência de contato para cobrança" (17px 600 #6E6E73); título "Pare de adivinhar."
   (até 112px); texto "O MotorCob usa seus agentes de IA para decidir, para cada cliente da carteira, quem acionar,
   por qual canal e em qual telefone. Todo dia. E eles aprendem com cada ocorrência." (trecho "quem acionar, por
   qual canal e em qual telefone." em #1D1D1F 600); botões "Agendar uma conversa" (vai a #contato) e "Ver a
   plataforma" (vai a #produto); linha: 100004817 → atraso recente → D+3 → WhatsApp → (11) 9••••-••17 → CPC · vira Hot.
2. Provocações (#F5F5F7): "Sua operação ainda começa com PROCV." / "O telefone certo existe. Você só não sabe qual
   é." / "Resultado no fim do mês é tarde demais." Até 84px. Cada frase passa de #C7C7CC para #1D1D1F quando chega
   a 62% da altura da tela; a segunda parte de cada uma fica #6E6E73. Com prefers-reduced-motion, já escuras.
3. #produto: "Apresentamos" + símbolo + "MotorCob" grande + "Da carga à ação, com inteligência." e, em #lista-site,
   uma janela (barra cinza com 3 bolinhas e "motorcob.online") com a prévia da Lista do dia: título "Lista do dia",
   "Banco X · Assessoria Demo · 5 de outubro", 4 cards de KPI (Carteira avaliada 2.600; Com ação hoje 1.869 71,9%;
   Fora por regra da esteira 545 21,0%; Sem contato válido 107 4,1%) e 4 linhas de motivo. Dados fictícios fixos.
4. (#F5F5F7) Três colunas: "Decide." "Aprende." "Prova." com os textos do protótipo.
5. #personas-site: "Personas" / "Cada perfil tem o seu canal." / "O Analista mede o CPC por real gasto em cada
   canal. Com evidência firme, o Estrategista sugere a mudança na régua." + 3 painéis iguais aos da tela Personas
   (pasta 04), com dados fictícios fixos: Digital nativo (verde #1F8A4C, 76, RCS 29,1% melhor, WhatsApp 23,4% 2º,
   SMS 10,4%, E-mail 2,6%); Sênior (60+) (#A2552B, 58, Discador 18,2% melhor, Agente virtual 12,9% 2º, SMS 6,1%,
   WhatsApp 4,0%); Ticket alto (#C62828, 41, Agente virtual 14,7% melhor, Discador 11,3% 2º, WhatsApp 9,8%, E-mail 1,2%).
6. #agentes: "Seus agentes" / "Quatro especialistas, trabalhando antes de você chegar." + 4 cards #F5F5F7 raio 18:
   Ingestão, Contato, Analista, Estrategista (textos do protótipo) + "A IA aprende. Você decide."
7. #seguranca (#F5F5F7): "Dado de devedor não é planilha compartilhada. Nunca foi." ("Nunca foi." em #AEAEB2) +
   Isolamento por empresa / Telas sem dado pessoal / Permissões e histórico.
8. #contato: "Mostre a sua carteira." + formulário: Nome*, Empresa, E-mail*, Telefone, Mensagem, caixa obrigatória
   "Concordo que o MotorCob use estes dados para retornar o meu contato.", campo escondido "site" (se preenchido,
   não envia). Enviar: supabase.from('contatos_site').insert({nome, empresa, email, telefone, mensagem,
   consentimento: true, origem: 'home'}) SEM .select(). Sucesso: "Recebemos. Retornamos em até 1 dia útil."
   Limite: "Muitas mensagens em pouco tempo. Tente mais tarde." Outro erro: "Não conseguimos enviar agora."
9. Rodapé #F5F5F7 12px: "© 2026 MotorCob" · Entrar · Contato · Privacidade (/privacidade, texto simples).

LOGIN (/login)
Tela branca, coluna de 380px no centro: símbolo 56px; "Entre no MotorCob." (34px 600); "O contato certo, no canal
certo, antes de cada disparo." (17px #6E6E73); E-mail e Senha no MESMO bloco (borda #D2D2D7, raio 14, rótulo 12px
em cima, valor 17px, divisória fina); "Manter conectado" (accent-color #1D1D1F); botão "Continuar" (50px, largura
total, raio 12, #1D1D1F, 17px); links "Esqueceu a senha?" e "Acesso exclusivo para equipes convidadas. Primeiro
acesso"; no canto superior esquerdo "‹ Voltar ao site". Sem imagem e sem números.
- signInWithPassword; qualquer erro: "E-mail ou senha incorretos." Sem "Manter conectado": sessão só da aba.
- Depois: mfa.getAuthenticatorAssuranceLevel(). Admin sem TOTP → cadastrar autenticador (mfa.enroll totp, QR,
  código). Com fator em aal1 → tela "Digite o código." / "Use os 6 dígitos do seu aplicativo autenticador." com 6
  campos de 56px → challenge + verify. Enquanto carrega: "Preparando a lista de hoje…". Depois: /inicio.
- "Esqueceu a senha?" → resetPasswordForEmail(email, {redirectTo:'https://motorcob.online/redefinir-senha'});
  sempre responder "Se o e-mail estiver cadastrado, enviaremos um link para criar uma senha nova."
- "Primeiro acesso" → "Use o link do convite enviado pelo Admin da sua empresa."

SEO: title "MotorCob · Pare de adivinhar.", lang pt-BR, og:image og-motorcob.jpg do bucket site; plataforma noindex.
Sem rolagem lateral em 1440, 1024 e 390px.
```
