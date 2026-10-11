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
- Logo: símbolo Rotor + "MotorCob" 600 (nunca hélice/pás). Champanhe #C9A35A só dentro do símbolo.
  Fundo escuro (cabeçalho), 24px: <svg viewBox="0 0 100 100" width="24" height="24" aria-hidden="true"><circle cx="50" cy="50" r="38" fill="none" stroke="#3A3A3C" stroke-width="11"/><path d="M50 12 A38 38 0 0 1 86.1 38.3" fill="none" stroke="#C9A35A" stroke-width="11" stroke-linecap="round"/><path d="M83.6 70 A38 38 0 0 1 30 82.3" fill="none" stroke="#EEEAE2" stroke-width="11" stroke-linecap="round"/><path d="M16.4 67.6 A38 38 0 0 1 22 23.5" fill="none" stroke="#EEEAE2" stroke-width="11" stroke-linecap="round" opacity="0.55"/><circle cx="50" cy="50" r="11" fill="#C9A35A"/></svg>
  Fundo branco (login 56px, Apresentamos, favicon): <svg viewBox="0 0 100 100" width="56" height="56" aria-hidden="true"><circle cx="50" cy="50" r="38" fill="none" stroke="#D2D2D7" stroke-width="8"/><path d="M50 12 A38 38 0 0 1 86.1 38.3" fill="none" stroke="#C9A35A" stroke-width="8" stroke-linecap="round"/><path d="M83.6 70 A38 38 0 0 1 30 82.3" fill="none" stroke="#1D1D1F" stroke-width="8" stroke-linecap="round"/><path d="M16.4 67.6 A38 38 0 0 1 22 23.5" fill="none" stroke="#1D1D1F" stroke-width="8" stroke-linecap="round" opacity="0.35"/><circle cx="50" cy="50" r="11" fill="#C9A35A"/></svg>

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
   plataforma" (vai a #produto). Abaixo, cartão #F5F5F7 raio 18 (até 980px) com o título 13px 600 cinza "Como o
   MotorCob decide um cliente, antes do primeiro disparo do dia" e 6 etapas lado a lado ligadas por uma linha fina
   (ponto 9px em cada), rótulo 12px #6E6E73 em cima e valor 15px 600: Cliente 100004817 · Momento Atraso recente ·
   Dia na régua D+3 · Canal escolhido WhatsApp · Telefone Hot (11) 9••••-••17 · Resultado CPC · vira Hot (verde
   #248A3D, ponto #34C759). Nota 12px: "Dados fictícios. O MotorCob mostra só o ID do cliente, nunca CPF ou telefone
   completo." No celular, etapas em lista vertical (rótulo à esquerda, valor à direita).
2. Provocações (#F5F5F7): "Sua operação ainda começa com PROCV." / "O telefone certo existe. Você só não sabe qual
   é." / "Resultado no fim do mês é tarde demais." Até 84px. Cada frase passa de #C7C7CC para #1D1D1F quando chega
   a 62% da altura da tela; a segunda parte de cada uma fica #6E6E73. Com prefers-reduced-motion, já escuras.
3. #produto: "Apresentamos" + símbolo + "MotorCob" grande + "Da carga à ação, com inteligência." e, em #lista-site,
   uma janela (barra cinza com 3 bolinhas e "motorcob.online") com a prévia da Lista do dia: título "Lista do dia",
   "Banco X · Assessoria Demo · 5 de outubro", 4 cards de KPI (Carteira avaliada 2.600; Com ação hoje 1.869 71,9%;
   Fora por regra da esteira 545 21,0%; Sem contato válido 107 4,1%; ponto 8px de status antes do rótulo) e 4 linhas
   (ponto · título com legenda cinza · barra 4px · quantidade): Com ação hoje/Liberados para todos os canais 1.869;
   Esteira sem passo no D+5/Regra da esteira 324; Esteira sem passo hoje (D+2)/Regra da esteira 221; Sem telefone
   válido/Agente virtual · Discador 92. Dados fictícios fixos.
4. (#F5F5F7) Três colunas: "Decide." Cada cliente cai num segmento e recebe a ação do dia, no canal certo e no
   telefone Hot primeiro. / "Aprende." Cada ocorrência volta para o motor. CPC vira Hot, número inválido sai, o melhor
   canal de cada perfil aparece. / "Prova." Cada ação fica registrada com o motivo. O relatório do comitê sai pronto todo mês.
5. #personas-site: "Personas" (17px 600 #6E6E73) / "Cada perfil tem o seu canal." (título grande) / "O Analista mede o
   CPC por real gasto em cada canal. Com evidência firme, o Estrategista sugere a mudança na régua." + 3 cards brancos.
   Card: à esquerda ANEL de maturidade 84px (SVG: trilho circle r40 stroke #E5E5EA width 8; arco na cor da persona,
   stroke-dasharray "(M/100*251.3) 251.3", rotate(-90 50 50), número M no centro 22px 600 — M é maturidade, NÃO
   clientes); à direita ponto + nome 17px 600, critério + clientes 13px cinza, selo de evidência (pílula #F5F5F7).
   Ranking em grade 118px | 1fr | 84px: canal ("★ melhor"/"2º" 12px cinza) · barra 6px · "29,1% CPC" sem quebrar.
   Melhor e 2º na COR DO CANAL, demais #C7C7CC; sem ponto antes do canal. Dados fictícios fixos:
   Digital nativo #1F8A4C 76 "idade até 32 · tem WhatsApp · 549 clientes" Evidência firme: RCS 29,1 ★ melhor,
   WhatsApp 23,4 2º, SMS 10,4, E-mail 2,6 · Sênior (60+) #A2552B 58 "idade a partir de 60 · 481 clientes" Prévia:
   Discador 18,2 ★, Agente virtual 12,9 2º, SMS 6,1, WhatsApp 4,0 · Ticket alto #C62828 41 "saldo acima de R$ 10 mil ·
   153 clientes" Em formação: Agente virtual 14,7 ★, Discador 11,3 2º, WhatsApp 9,8, E-mail 1,2. "Dados fictícios."
6. #agentes: "Seus agentes" / "Quatro especialistas, trabalhando antes de você chegar." + 4 cards #F5F5F7 raio 18:
   Ingestão "Lê o arquivo de cada credor, reconhece o layout e separa o que é novo, o que saiu e o que fez acordo." ·
   Contato "Dá uma nota a cada telefone pelas evidências e escolhe o Hot. Número inválido sai sozinho." · Analista
   "Descobre o melhor canal de cada perfil pelo CPC por real gasto, e continua testando." · Estrategista "Propõe
   mudanças na régua com evidência e grau de certeza. Nada entra sem a sua aprovação." + "A IA aprende. Você decide."
7. #seguranca (#F5F5F7): "Dado de devedor não é planilha compartilhada. Nunca foi." ("Nunca foi." em #AEAEB2) +
   Isolamento por empresa "Garantido no banco de dados, não só na tela." · Telas sem dado pessoal "O site mostra o ID
   do cliente, nunca CPF ou telefone completo." · Permissões e histórico "Cada perfil vê o que deve. Cada alteração
   fica registrada."
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
- Só ao clicar em "Primeiro acesso" mostrar "Use o link do convite enviado pelo Admin da sua empresa."

SEO: title "MotorCob · Pare de adivinhar.", lang pt-BR, og:image og-motorcob.jpg do bucket site; plataforma noindex.
Sem rolagem lateral em 1440, 1024 e 390px.
```
