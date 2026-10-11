# Prompt Horizons — Correção: logo, personas e textos do site
Cole no Horizons e publique. Corrige o que saiu diferente do protótipo aprovado.

```text
Corrija 6 pontos. Não mude rotas, login, formulário, tabelas ou políticas.

1. LOGO (site, login, menu do sistema e favicon). O símbolo atual (círculo com 3 pás/hélice) está ERRADO.
Troque em TODOS os lugares por este SVG "Rotor" (anel em 3 segmentos com ponto no centro). Use exatamente:
Fundo escuro (cabeçalho do site e menu lateral do sistema), 24px:
<svg viewBox="0 0 100 100" width="24" height="24" aria-hidden="true"><circle cx="50" cy="50" r="38" fill="none" stroke="#3A3A3C" stroke-width="11"/><path d="M50 12 A38 38 0 0 1 86.1 38.3" fill="none" stroke="#C9A35A" stroke-width="11" stroke-linecap="round"/><path d="M83.6 70 A38 38 0 0 1 30 82.3" fill="none" stroke="#EEEAE2" stroke-width="11" stroke-linecap="round"/><path d="M16.4 67.6 A38 38 0 0 1 22 23.5" fill="none" stroke="#EEEAE2" stroke-width="11" stroke-linecap="round" opacity="0.55"/><circle cx="50" cy="50" r="11" fill="#C9A35A"/></svg>
Fundo branco (login 56px, "Apresentamos MotorCob" com a altura do texto, favicon):
<svg viewBox="0 0 100 100" width="56" height="56" aria-hidden="true"><circle cx="50" cy="50" r="38" fill="none" stroke="#D2D2D7" stroke-width="8"/><path d="M50 12 A38 38 0 0 1 86.1 38.3" fill="none" stroke="#C9A35A" stroke-width="8" stroke-linecap="round"/><path d="M83.6 70 A38 38 0 0 1 30 82.3" fill="none" stroke="#1D1D1F" stroke-width="8" stroke-linecap="round"/><path d="M16.4 67.6 A38 38 0 0 1 22 23.5" fill="none" stroke="#1D1D1F" stroke-width="8" stroke-linecap="round" opacity="0.35"/><circle cx="50" cy="50" r="11" fill="#C9A35A"/></svg>
Não redesenhe, não troque cores, não ponha círculo em volta. Ao lado: "MotorCob" peso 600.

2. PERSONAS (seção #personas-site do site e a tela Personas do sistema). Cabeçalho da seção: "Personas" pequeno
(17px 600 #6E6E73), título grande "Cada perfil tem o seu canal." (mesmo estilo dos outros títulos de seção), texto
"O Analista mede o CPC por real gasto em cada canal. Com evidência firme, o Estrategista sugere a mudança na régua.",
3 cards e embaixo "Dados fictícios." (13px cinza). Cada card (branco, raio 16, sombra leve, padding 20px):
- Topo em linha: ANEL de maturidade 84x84 à esquerda + bloco de texto à direita.
  Anel = SVG viewBox 0 0 100 100: trilho <circle r=40 cx=50 cy=50 stroke #E5E5EA stroke-width 8 fill none>; arco
  <circle r=40 stroke=COR DA PERSONA stroke-width 8 stroke-linecap round stroke-dasharray="(M/100*251.3) 251.3"
  transform="rotate(-90 50 50)">; número M no centro (22px 600 #1D1D1F). M é a MATURIDADE, não quantidade.
  Texto: ponto 8px da cor + nome (17px 600); critério + clientes (13px #6E6E73); selo de evidência (12px, pílula
  fundo #F5F5F7, texto #6E6E73).
- Ranking: 4 linhas em grade 118px | 1fr | 84px = canal (14px; "★ melhor" ou "2º" em 12px cinza ao lado) · barra
  6px (trilho #E5E5EA, preenchimento proporcional) · valor "29,1% CPC" (13px #6E6E73, à direita, sem quebrar).
  Barra do melhor e do 2º na COR DO CANAL (WhatsApp #1F8A4C, RCS #3B5BA9, SMS #7A4FB0, E-mail #A2552B, Agente
  virtual #0E7C86, Discador #475569); as outras #C7C7CC. Sem pontinho antes do nome do canal.
Dados (site):
Digital nativo · cor #1F8A4C · maturidade 76 · "idade até 32 · tem WhatsApp · 549 clientes" · "Evidência firme" ·
  RCS 29,1 ★ melhor · WhatsApp 23,4 2º · SMS 10,4 · E-mail 2,6
Sênior (60+) · #A2552B · 58 · "idade a partir de 60 · 481 clientes" · "Prévia" ·
  Discador 18,2 ★ melhor · Agente virtual 12,9 2º · SMS 6,1 · WhatsApp 4,0
Ticket alto · #C62828 · 41 · "saldo acima de R$ 10 mil · 153 clientes" · "Em formação" ·
  Agente virtual 14,7 ★ melhor · Discador 11,3 2º · WhatsApp 9,8 · E-mail 1,2

3. PRÉVIA DA LISTA DO DIA (#lista-site). Nos 4 cards de KPI: ponto 8px antes do rótulo (Com ação #34C759, Fora
pela esteira #FF9500, Sem contato #FF3B30; Carteira sem ponto) e o % ao lado do número (Com ação em #248A3D).
Linhas em lista branca com divisórias, grade 8px | 1fr | 160px | 64px = ponto · título (15px) com legenda 13px
cinza embaixo · barra 4px proporcional · quantidade à direita:
Com ação hoje · Liberados para todos os canais · 1.869 · #34C759
Esteira sem passo no D+5 · Regra da esteira · 324 · #FF9500
Esteira sem passo hoje (D+2) · Regra da esteira · 221 · #FF9500
Sem telefone válido · Agente virtual · Discador · 92 · #FF3B30

4. TEXTOS (use exatamente):
Decide. "Cada cliente cai num segmento e recebe a ação do dia, no canal certo e no telefone Hot primeiro."
Aprende. "Cada ocorrência volta para o motor. CPC vira Hot, número inválido sai, o melhor canal de cada perfil aparece."
Prova. "Cada ação fica registrada com o motivo. O relatório do comitê sai pronto todo mês."
Agentes: Ingestão "Lê o arquivo de cada credor, reconhece o layout e separa o que é novo, o que saiu e o que fez
acordo." · Contato "Dá uma nota a cada telefone pelas evidências e escolhe o Hot. Número inválido sai sozinho." ·
Analista "Descobre o melhor canal de cada perfil pelo CPC por real gasto, e continua testando." · Estrategista
"Propõe mudanças na régua com evidência e grau de certeza. Nada entra sem a sua aprovação."
Título dos agentes: "Seus agentes" (pequeno) + "Quatro especialistas, trabalhando antes de você chegar." (grande).
Segurança: Isolamento por empresa "Garantido no banco de dados, não só na tela." · Telas sem dado pessoal "O site
mostra o ID do cliente, nunca CPF ou telefone completo." · Permissões e histórico "Cada perfil vê o que deve. Cada
alteração fica registrada."

5. CARTÃO DA DECISÃO (abertura): o valor "(11) 9••••-••17" não pode quebrar linha (white-space: nowrap); o rótulo
é "Telefone Hot" e o valor só o número.

6. LOGIN: o texto "Use o link do convite enviado pelo Admin da sua empresa." só aparece depois de clicar em
"Primeiro acesso" (hoje aparece sempre).
```
