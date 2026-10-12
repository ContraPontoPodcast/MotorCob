# Prompt Horizons — Workspace 23: MotorCX, login com escolha da frente e tema por frente

Rode depois do **SQL 18** (`01_banco/18_motorcli.sql`). A marca mãe passa a ser **MotorCX**; MotorCob (Cobrança) e
MotorCli (Jornada do Cliente) são frentes. Arquitetura igual: muda o nome, a cor e os textos. Quem só tem o
MotorCob continua entrando direto, como hoje. Protótipo do login: https://claude.ai/artifact/2pCM2GLo7Dcpw554gNk4Hj
(aba Login). Símbolo: `03_site_e_login/imagens/motorcx-simbolo.svg`.

```text
MotorCX com duas frentes. Não mude tabelas, políticas nem as consultas das telas; só login, layout e textos.

1. MARCA: o símbolo do MotorCX (SVG abaixo, inline num componente MarcaMotorCX) substitui o logo atual no login,
   no Workspace e no menu lateral. SVG 100x100: círculo r38 traço #3A3A3C 11; arco "M50 12 A38 38 0 0 1 86.1 38.3"
   traço #C9A35A 11 ponta redonda; arco "M83.6 70 A38 38 0 0 1 30 82.3" traço #8E8E93 11 ponta redonda; círculo
   central r11 #C9A35A. Ao lado: nome da FRENTE atual (MotorCob ou MotorCli) 17px 700 e, embaixo, "por MotorCX"
   11px #8E8E93. No login (antes da frente) só "MotorCX". Title do navegador: "{Frente} · MotorCX".

2. FRENTE ATUAL (contexto FrenteProvider, junto do contexto de empresa):
   - frentes = rpc('minhas_frentes') depois do login; guarde em sessionStorage "mc-frente".
   - FRENTES = { motorcob: {nome:'MotorCob', area:'Cobrança', cor:'#C9A35A', sigla:'COB'},
                 motorcli: {nome:'MotorCli', area:'Jornada do Cliente', cor:'#8E8E93', sigla:'CLI'} }.
   - A cor da frente vira a variável CSS --frente (ponto do produto, item ativo do menu, selo da frente). O resto
     do visual não muda.

3. LOGIN (/login), depois da senha e do código de duas etapas:
   - 1 frente: entra direto nela (sem tela nova).
   - 2 frentes e perfis.frente_preferida preenchida: entra direto na preferida.
   - 2 frentes sem preferida: passo "Escolha a frente." com subtítulo "Você tem acesso às duas. Dá para trocar
     depois pelo menu." Dois botões grandes (raio 14, borda 1px #D2D2D7; escolhido: borda 2px #1D1D1F), cada um
     com quadrado 40px raio 11 na cor da frente com a SIGLA branca 12px 800 (COB / CLI), o nome 16px 600 e a
     área 13.5px #6E6E73. Checkbox "Lembrar a minha escolha neste navegador" (marcado). Botão "Entrar" chama
     rpc('escolher_frente', {p_frente, p_lembrar}) e segue. Rodapé 12.5px: "Quem tem acesso a uma frente só entra
     direto nela, sem esta escolha."
   - Título do primeiro passo: "Entre no MotorCX." e subtítulo "Uma conta para todas as frentes."

4. TROCAR DE FRENTE: no menu do usuário (avatar do topo do Workspace e rodapé do menu lateral), item
   "Trocar para MotorCli" (ou MotorCob), só para quem tem as duas. Troca o contexto, chama
   rpc('escolher_frente', {p_frente, p_lembrar: true}) e vai para /workspace. Sem recarregar a página.

5. TEXTOS QUE MUDAM DE NOME (em todo o projeto): "Assistente MotorCob" → "Assistente MotorCX"; "Console
   MotorCob" → "Console MotorCX"; "Radar MotorCob" → "Radar"; "Suporte MotorCob" → "Suporte MotorCX"; "equipe
   MotorCob" → "equipe MotorCX". Onde o texto fala do produto do cliente (títulos, Início do Workspace, e-mails
   do sistema), use o nome da frente atual. Não troque nomes de tabelas, rotas nem chaves de localStorage.

6. WORKSPACE (/workspace): saudação com o selo da frente (ponto --frente + "MotorCob · Cobrança"). Cards de
   produto por frente: MotorCob = Orquestração, Mensageria; MotorCli = Jornada, Mensageria (o card Jornada abre
   /jornada, feito no prompt 24; até lá, "Em breve"). Workspace, Empresa, Conta e Suporte são iguais nas duas.

7. EMPRESA COM SÓ O MOTORCLI: o seletor de produto e o Início não mostram Orquestração; quem abrir /inicio vai
   para /jornada.

Confira em 1440 e 390px: usuário só MotorCob entra como hoje; usuário com as duas vê a escolha uma vez e, com
"lembrar", não vê mais; "Trocar para MotorCli" troca nome e cor sem sair da conta.
```
