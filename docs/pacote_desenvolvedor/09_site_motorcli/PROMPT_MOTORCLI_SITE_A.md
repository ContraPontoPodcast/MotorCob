# Prompt Horizons — Site motorcli.online (parte A): marca, topo, abertura, momentos e como funciona

Projeto novo no Horizons (veja o LEIA desta pasta). Protótipo: https://claude.ai/artifact/RFpwsGvbDevrHmSUZHUaYE

```text
Crie o site de apresentação do MotorCli (uma página só, em português do Brasil). NÃO crie login, cadastro,
painel nem área logada: este site é só vitrine. Estilo Apple: fundo branco, seções pretas #000 de ponta a
ponta da janela, texto #1D1D1F, cinza #6E6E73, títulos 700 com a segunda frase em cinza #86868B, olho 13px 600
maiúsculo #C9A35A, cantos 20–24px, fonte do sistema (-apple-system, Segoe UI, Inter). Conteúdo em até 1200px,
24px de respiro no celular. Título da aba: "MotorCli · Jornada do Cliente, uma frente do MotorCX".

1. MARCA: símbolo do MotorCX em SVG inline 22px (viewBox 0 0 100 100: círculo r38 sem preenchimento, traço
   #3A3A3C 11; arco "M50 12 A38 38 0 0 1 86.1 38.3" traço #C9A35A 11 ponta redonda; arco "M83.6 70 A38 38 0 0 1
   30 82.3" traço #8E8E93 11 ponta redonda; círculo central r11 #C9A35A). Ao lado: "MotorCli" 18px 700 e,
   embaixo, "por MotorCX" 10.5px #8E8E93. Favicon: o mesmo símbolo.

2. TOPO fixo escuro (#1D1D1F com blur, 56px): marca · Momentos · Como funciona · Cuidado com o cliente ·
   Plataforma · Segurança (âncoras, rolagem suave) · à direita "Entrar" (link, ver parte B) e botão branco
   "Agendar demonstração" (#contato). No celular: só a marca, "Entrar" e o botão.

3. ABERTURA (2 colunas; 1 no celular): olho "MotorCli · Jornada do Cliente · uma frente do MotorCX". H1 (40 a
   72px): "A conversa certa em cada momento." e, em cinza, "Do primeiro dia à reativação." Texto 20px: "O
   MotorCli decide, todo dia, quem da sua base precisa de uma conversa, por qual canal e com qual mensagem:
   boas-vindas, ativação, lembrete antes do vencimento, retenção e reativação. Sem calendário fixo: com
   evidência." Botões "Agendar demonstração" (preto) e "Ver os momentos" (cinza claro, #momentos).
   À direita, cartão cinza claro com uma janela branca: "Jornada de hoje · Carteira Cartões · MotorCli",
   "6.120 clientes com uma conversa hoje" e 5 linhas (ID · texto · pílula colorida): ID 9021 Pré-vencimento ·
   vence em 2 dias (SMS roxo #7A4FB0) · ID 7710 Boas-vindas · contratou ontem (E-mail #A0522D) · ID 5530
   Ativação · 7 dias sem usar o crédito (RCS #3B5BA9) · ID 4402 Retenção · 45 dias sem atividade (WhatsApp
   #1E7A36) · ID 3378 Fica de fora · em atraso: vai para a cobrança (MotorCob #8E8E93). Dados fictícios.

4. FAIXA "PARA QUEM" (linhas finas acima e abaixo, 4 colunas): CX e relacionamento (A jornada com decisão,
   não com calendário) · Crédito e cartões (Ativação do crédito novo e lembrete antes do vencimento) · Varejo,
   telecom e serviços (Retenção de quem esfriou, no canal em que ainda responde) · Gestão (Custo e resultado de
   cada momento, sem planilha).

5. MOMENTOS (#momentos): olho "Momentos", "Cinco momentos da relação." + cinza "Cada um com a sua conversa.",
   texto "Cada cliente fica em um momento por dia, na ordem de prioridade abaixo. Você liga, desliga e ajusta
   cada passo." 6 cartões cinza claro (3 colunas; 1 no celular), cada um com quadrado preto 32px numerado,
   nome 22px, "quando" 13px #C9A35A, frase e pílulas brancas dos passos no rodapé:
   1 Pré-vencimento — De 5 dias antes até o dia do vencimento — Um aviso leve, no canal que custa menos. Quem já
     pagou sai da lista. — D-5 RCS ou SMS + e-mail · D-2 melhor canal · D0 SMS
   2 Boas-vindas — Até 2 dias depois da contratação — A primeira conversa define o canal que vai funcionar
     depois. — D0 e-mail + RCS ou SMS
   3 Ativação — De 3 a 30 dias, só para quem não ativou — Quem contratou e não usou recebe um convite, depois
     outro canal. — D+3 · D+7 · D+15 · D+30 agente virtual
   4 Retenção — De 30 a 89 dias sem atividade — O silêncio vira sinal: o MotorCli percebe e escolhe a hora de
     retomar. — D+30 · D+45 · D+60 · D+75
   5 Reativação — De 90 a 365 dias sem atividade — Poucas tentativas, espaçadas, no canal com mais chance de
     resposta. — D+90 · D+120 · D+180 · D+270
   ! Em atraso? (cartão branco com borda tracejada, quadrado cinza #8E8E93) — Dias de atraso maior que zero —
     O cliente sai da jornada e fica com a cobrança, no MotorCob. Nenhuma oferta para quem está devendo. —
     MotorCob · frente de Cobrança

6. COMO FUNCIONA (#como, seção preta): "Sua base entra de manhã." + cinza "A conversa de cada cliente sai
   pronta." 3 cartões (o do meio branco em destaque, os outros #1C1C1E): 1 · Sua base — "Dois arquivos, ou a
   API" — Clientes (contratação, vencimento, ativação, última atividade) e contatos. Com modelo pronto para
   baixar. · 2 · Inteligência MotorCX — "O MotorCli decide" — Em que momento cada cliente está, qual passo é o
   de hoje, qual canal e qual contato. O telefone Hot sai primeiro. · 3 · Execução — "A conversa acontece" —
   Pela Mensageria (SMS, RCS e e-mail) ou num arquivo por canal para o fornecedor que você já tem. Frase
   final: "Entregas, cliques, respostas e descadastros voltam para o MotorCX: a próxima decisão já sabe o que
   funcionou."

Confira em 1440 e 390px: sem rolagem lateral; o topo não cobre o título das seções ao clicar no menu.
```
