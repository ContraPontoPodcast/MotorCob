# Passo 4 — Sistema na linha Apple (menu escuro)

Referência: `../03_site_e_login/referencia/motorcob-prototipo.html` (entre por "Entrar", qualquer senha, qualquer
código) e as imagens em `telas/`. Base: guia do designer (pasta 06) + decisões do produto (`06_referencias/DECISOES_SOBRE_O_GUIA.md`).
**Não muda** rotas, gravações, tabelas, políticas nem regras. Muda visual, textos de cabeçalho e a Lista do dia.

## Tokens (CSS variables no tema global; nenhuma cor, fonte ou sombra solta no código)
```css
:root {
  --mc-bg: #FFFFFF; --mc-fill: #F5F5F7; --mc-fill-2: #F2F2F7; --mc-segment: #EEEEF0;
  --mc-separator: #E5E5EA; --mc-separator-soft: #F0F0F2; --mc-border-field: #D2D2D7;
  --mc-label: #1D1D1F; --mc-label-2: #6E6E73; --mc-label-3: #8E8E93; --mc-brand: #C9A35A;
  --mc-green: #34C759; --mc-green-text: #248A3D; --mc-orange: #FF9500; --mc-red: #FF3B30; --mc-gray: #AEAEB2;
  --mc-menu: #161617; --mc-menu-text: #E5E5EA; --mc-menu-active: rgba(255,255,255,.12);
  --mc-radius-sm: 7px; --mc-radius-md: 10px; --mc-radius-lg: 14px; --mc-radius-xl: 16px; --mc-radius-pill: 980px;
  --mc-shadow-card: 0 0 0 1px var(--mc-separator), 0 2px 12px rgba(0,0,0,.04);
  --mc-shadow-segment: 0 1px 3px rgba(0,0,0,.12);
  --mc-font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
}
body { font-family: var(--mc-font); color: var(--mc-label); background: var(--mc-bg); -webkit-font-smoothing: antialiased }
.num { font-variant-numeric: tabular-nums }
```
Sai: Inter, Geist, azul-petróleo `#0F4C5C`/`#103E4B` e âmbar `#E9A23B` como cor de interface. Nada de fonte mono.

## Logo (Rotor)
Sai o quadrado com "M" e o descritor "Gestão de contatos". Símbolo + "MotorCob" (15/600). No **menu escuro**:
```html
<svg width="24" height="24" viewBox="0 0 100 100" role="img" aria-label="MotorCob">
  <circle cx="50" cy="50" r="38" fill="none" stroke="#3A3A3C" stroke-width="11"/>
  <path d="M50 12 A38 38 0 0 1 86.1 38.3" fill="none" stroke="#C9A35A" stroke-width="11" stroke-linecap="round"/>
  <path d="M83.6 70 A38 38 0 0 1 30 82.3" fill="none" stroke="#EEEAE2" stroke-width="11" stroke-linecap="round"/>
  <path d="M16.4 67.6 A38 38 0 0 1 22 23.5" fill="none" stroke="#EEEAE2" stroke-width="11" stroke-linecap="round" opacity=".55"/>
  <circle cx="50" cy="50" r="11" fill="#C9A35A"/></svg>
```
No **fundo branco** (login, favicon): trilho `#D2D2D7`, segmentos `#1D1D1F` (o terceiro com opacidade .35), resto igual.
Login: 56 px com `stroke-width` 8.

## Menu lateral (escuro — decisão do produto)
232 px, fundo `var(--mc-menu)`, sem borda. Logo no topo; usuário (avatar `#3A3A3C`, nome branco, perfil `#8E8E93`) e
"Sair" no rodapé, com divisória `rgba(255,255,255,.1)`. Grupos com rótulo 11/600 `#8E8E93`, sem caixa-alta:
- **Operação:** Início · Lista do dia · Ações · Painel
- **Carteira:** Clientes · Personas · Credores
- **Estratégia:** Mapa da Esteira · Orquestração · Comitê
- **Dados:** Enviar arquivos
- **Administração:** Canais e frases · Usuários e permissões · Auditoria (cada item só com a permissão — pasta 05)

Item: padding 6px 10px, raio 7, 14 px `var(--mc-menu-text)`, ícone Lucide 16 px `#AEAEB2`. Hover `rgba(255,255,255,.06)`.
Ativo: fundo `var(--mc-menu-active)`, texto e ícone brancos, peso 600, `aria-current="page"`.
Abaixo de 980 px: vira barra escura no topo (logo + botão "Menu") e abre o menu por cima.

## Cabeçalho de cada tela (some a barra superior atual)
Área de conteúdo: padding 28px no topo e `clamp(16px, 4vw, 48px)` nas laterais; 28 px entre blocos.
À esquerda: título 28/700 e, abaixo, o contexto em `--mc-label-2`. À direita: campo **Buscar cliente** (260 px,
36 px, raio 10, fundo `--mc-fill-2`, sem borda, lupa 15 px, ⌘K / Ctrl+K), botão secundário do credor e o botão
principal da tela. A busca procura **só por ID do cliente ou contrato** (nunca CPF, nome ou telefone).
| Tela | Título | Contexto | Botão principal |
|---|---|---|---|
| Início | Início | Banco X · Assessoria Demo · 5 de outubro · rotina concluída às 06:12 | Abrir Lista do dia |
| Lista do dia | Lista do dia | Banco X · Assessoria Demo · 5 de outubro | Baixar lista |
| Orquestração | Orquestração | {segmento} · {N} clientes · {credor} | Salvar |
| Personas | Personas | O Analista mede o CPC por real gasto… | — |
| Cliente | Cliente {ID} | {segmento} · persona {nome} · {estado} · telefone Hot | — |
| Usuários | Usuários e permissões | Convide pessoas, defina o perfil e ajuste os acessos… | Convidar usuário |
Demais telas: mesmo padrão, título = nome do item do menu. Datas por extenso ("5 de outubro"); export em ISO.

## Componentes
- **Botão principal:** 36 px, padding 0 16px, pílula, fundo `--mc-label`, texto branco 500 15px; hover opacidade .85.
- **Secundário:** 36 px, raio 10, fundo `--mc-fill-2`, sem borda; hover `--mc-separator`.
- **Card de KPI:** fundo `--mc-fill`, raio 16, padding 18px 20px, sem borda; rótulo 13 px `--mc-label-2` com
  ponto de status 8 px; número 30/600 **sem cor**; percentual 15 px `--mc-label-2` (em "Com ação": `--mc-green-text`).
  Grade `repeat(auto-fit, minmax(180px, 1fr))`, gap 12.
- **Card / lista agrupada:** branco, raio 16, `--mc-shadow-card`, sem borda; linhas com padding 12px 20px e
  divisória `--mc-separator-soft`; hover da linha `--mc-fill`.
- **Controle segmentado:** trilho `--mc-segment`, padding 2, raio 9; segmentos 30 px, 13/500; ativo branco +
  `--mc-shadow-segment`, `aria-pressed="true"`.
- **Interruptor:** estilo iOS, 42×26, ligado `--mc-green`, desligado `#E9E9EB`, bolinha branca com sombra.
- **Selo** (Ativo, Ligado, Evidência firme): 12/500, fundo `--mc-fill`; positivos em `--mc-green-text` sobre `rgba(52,199,89,.12)`.
- **Aviso:** fundo `--mc-fill`, raio 12, ícone laranja, texto `--mc-label`.
- Barras de progresso 4 px (6 px nas personas), trilho `--mc-separator`. Foco: `outline 3px rgba(0,113,227,.5)`.

## Lista do dia (dados da view `motivos_hoje` — rode `01_banco/02_motivo_categoria.sql`)
`from('motivos_hoje').select('categoria,titulo,clientes').eq('credor_id', credor)`.
`categoria` vazia → `regra_esteira`. Total = soma de `clientes`.
- KPIs: Carteira avaliada (total) · Com ação hoje (`com_acao`) · Fora por regra da esteira (`regra_esteira`) ·
  Sem contato válido (`sem_contato`), com % sobre o total.
- "Por que hoje" (título 20/600) + segmentado **Todos · Em ação · Esteira · Sem contato** (encerrado só em Todos).
- Linha: grade `8px | 1fr | 160px | 64px` = ponto de status · `titulo` (15 px, uma linha, reticências) com a
  legenda em 13 px `--mc-label-2` · barra de participação · quantidade à direita. Ordem: com_acao, depois por quantidade.
  Ponto e barra: com_acao `--mc-green`, regra_esteira `--mc-orange`, sem_contato `--mc-red`, encerrado `--mc-gray`.
  Legenda: com_acao "Liberados para todos os canais" · regra_esteira "Regra da esteira" · sem_contato
  "Sem contato para os canais do dia" · encerrado "Fora da cobrança". Celular: some a barra.

## Orquestração (decisão do produto: canais coloridos)
Segmentos no controle segmentado. Paleta de canais e ações nos dias como **pílulas sólidas** na cor do canal,
texto branco 500: WhatsApp `#1F8A4C` · RCS `#3B5BA9` · SMS `#7A4FB0` · E-mail `#A2552B` · Agente virtual `#0E7C86`
· Discador `#475569` · Enriquecimento `#64748B`. "★ Melhor canal da persona": contorno tracejado `--mc-border-field`.
Bolinha de mensagem (18 px) dentro da pílula, conforme o canal:
- **WhatsApp e RCS: template** (ícone `FileText`). Template = frase do canal com `codigo_template` (nome aprovado no
  provedor). Clicar abre o painel "Escolher template" com busca por nome, código e texto.
- **SMS e Agente virtual: frase** (ícone `MessageCircle`), painel "Escolher frase" com busca.
- **Discador, E-mail e Enriquecimento: sem mensagem** — nenhuma bolinha nem campo.
Estados: com escolha = branca cheia com o ícone na cor do canal (tooltip com o nome); sem = só contorno branco 70%;
desativada = vermelha `#C62828`. Regra completa (canal do CPC, tela Canais e frases, playbook) em `PROMPT_TEMPLATES.md`.
Faixas (Cliente novo, Deu CPC, Não CPC, Acordo, Como vai funcionar) como cards recolhíveis; selo "Ligado".
Dias vazios: tracejado `--mc-border-field`, "solte um canal aqui".

## Personas
Card por persona: anel de maturidade 84 px na **cor da persona** (trilho `--mc-separator`, número 22/600),
pontinho da cor ao lado do nome, selo de evidência. Ranking de canais: **melhor e 2º na cor do canal**, demais
`#C7C7CC`; valor "29,1% CPC" sem quebra de linha. Paleta de personas: `#1F8A4C #A2552B #C62828 #3B5BA9 #7A4FB0 #0E7C86`.

## Critérios de aceite
- Telas iguais às imagens de `telas/` em 1440, 1024 e 390 px, no Mac e no Windows; sem rolagem lateral.
- Nenhum `#0F4C5C`, `#103E4B`, `#E9A23B`, Inter ou Geist no código. Champanhe só no símbolo.
- Lista do dia soma igual ao total de `motivos_hoje`; filtros mostram só o grupo escolhido.
- Busca não aceita CPF/nome; contraste AA nos textos (`--mc-label-3` só em rótulos de grupo e placeholders).
