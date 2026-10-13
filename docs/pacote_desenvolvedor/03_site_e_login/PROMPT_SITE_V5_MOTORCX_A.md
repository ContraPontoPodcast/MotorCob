# Prompt Horizons — Site v5 MotorCX (parte A): marca, topo, como funciona, decisões e frentes

Substitui o PROMPT_SITE_V4 (não cole o V4). Rode quando o domínio do MotorCX estiver pronto; a parte B vem
logo depois. Protótipo aprovado: https://claude.ai/artifact/2pCM2GLo7Dcpw554gNk4Hj (cópia em
`referencia/motorcx-site-prototipo.html`). Símbolo: `imagens/motorcx-simbolo.svg`. Dados fictícios.

```text
REESCREVA O SITE PÚBLICO (/) para a marca MotorCX. Não mexa no login nem na plataforma. Linha Apple de sempre
(fundo branco, seções pretas #000 de ponta a ponta, títulos 700 com a 2ª frase em cinza #86868B, olho 13px 600
maiúsculo #C9A35A). Conteúdo em até 1200px, 24px de respiro no celular. Apague as seções antigas que não
estiverem abaixo. Esta é a parte A: do topo até as frentes.

1. MARCA: símbolo MotorCX em SVG inline (círculo r38 traço #3A3A3C 11; arco "M50 12 A38 38 0 0 1 86.1 38.3"
   #C9A35A; arco "M83.6 70 A38 38 0 0 1 30 82.3" #8E8E93; centro r11 #C9A35A) + "MotorCX". Title: "MotorCX ·
   Inteligência de decisão para a experiência do cliente". Descrição (meta) com essa mesma frase.

2. TOPO fixo escuro (#1D1D1F com blur): marca · Como funciona · Decisões · MotorCob e MotorCli · Plataforma ·
   Segurança · à direita "Entrar" (/login) e o botão branco "Agendar demonstração" (#contato).

3. HERO (2 colunas; 1 no celular): olho "MotorCX · Inteligência de decisão para a experiência do cliente".
   H1: "Cada cliente, a conversa certa." + cinza "No canal, no momento e no telefone certos." Texto: "O MotorCX
   aprende com cada interação da sua base e decide quem contatar, como, quando e o que cada resposta quer dizer.
   Na cobrança, com o MotorCob. Em toda a jornada do cliente, com o MotorCli." Botões: "Agendar demonstração" e
   "Como o MotorCX decide" (#como). Ao lado, cartão "Decisões de hoje · MotorCX" com "18.342 clientes com uma
   decisão pronta" e 4 linhas: ID 4817 MotorCob · atraso D+3 · RCS no telefone Hot (pílula RCS) · ID 9021
   MotorCli · vence em 2 dias · lembrete leve (SMS) · ID 5530 MotorCli · crédito novo sem uso · ativação
   (E-mail) · ID 3378 MotorCob · ignorou 4 mensagens · voz (Agente virtual).

4. FAIXA "PARA QUEM" (4 colunas): Empresas de crédito (Bancos, financeiras, varejo, telecom e serviços) ·
   Assessorias de cobrança (Várias carteiras e credores na mesma inteligência) · CX e relacionamento (A jornada
   do cliente com decisão, não com calendário) · Gestão (Resultado e custo por decisão, sem planilha).

5. COMO FUNCIONA (#como): "Dados entram, decisões saem." + cinza "E cada resultado ensina a próxima." Três
   camadas lado a lado (a do meio em destaque escuro):
   1 · Dados — "O que a sua operação já tem": Arquivo ou API · Entregas, falhas, cliques e respostas ·
   Pagamentos, acordos e ocorrências.
   2 · Inteligência MotorCX — "O que o MotorCX decide": "Personas, Curador, Localizador, Analista de Negócio,
   Estrategista e Radar transformam os dados em decisão, com evidência." Quem contatar e quem deixar em paz ·
   Canal, telefone e momento · O que a resposta quer dizer · O que mudar na jornada.
   3 · Execução — "Onde a decisão vira conversa": Orquestração e Mensageria · Lista do dia por canal · API.
   Frase final: "O resultado de cada conversa volta para o MotorCX: quanto mais a base roda, melhor a decisão
   de amanhã."

6. DECISÕES (#decisoes, seção preta): "Seis decisões que hoje são palpite." + cinza "No MotorCX, são
   evidência." 6 cartões #1C1C1E (3x2): Quem contatar hoje · Por qual canal · Em qual telefone · Em que ponto da
   jornada · O que o cliente quis dizer · O que mudar na jornada; cada um com 1 frase e uma linha de evidência
   fictícia (copie do protótipo).

7. FRENTES (#frentes): olho "Frentes de atuação", "Uma inteligência." + cinza "Duas frentes de atuação.",
   texto "O MotorCob e o MotorCli são o MotorCX aplicado a dois momentos da relação com o cliente: a mesma
   inteligência, a mesma plataforma e a mesma segurança. Você liga as frentes que usa." Dois cartões com o
   quadrado da sigla (COB fundo #C9A35A; CLI fundo #8E8E93; texto branco 14px 800): MotorCob · Frente de
   Cobrança (4 itens do protótipo; rodapé "Para áreas de cobrança, credores e assessorias") e MotorCli com o selo
   "EM BREVE" · Frente de Jornada do Cliente (rodapé "Para áreas de CX, relacionamento e crédito").
   Abaixo, "Cada momento pede uma conversa diferente." e abas com ponto na cor da frente: Atraso recente,
   Atraso longo, Acordos e quebras (MotorCob) · Boas-vindas e ativação, Pré-vencimento, Retenção e reativação
   (MotorCli, com "EM BREVE" no título). Painel de cada aba: olho "{Frente} · {momento}", título, frase, chips
   dos recursos e 3 itens (textos do protótipo).

Confira em 1440 e 390px: sem rolagem lateral; o topo não cobre o título das seções ao clicar no menu.
```
