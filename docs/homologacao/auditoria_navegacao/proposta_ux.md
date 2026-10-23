# MotorCX: proposta de UX para a navegação (resposta à auditoria de CX)

Data: 23/10/2026 · UX designer · Entrada: `cx/relatorio_cx.md` (CX-01 a CX-25), prompts 68–72, SQL 45 (`origin/main`),
`docs/homologacao/workspace-prototipo.html`.

Entregas nesta pasta (`.../scratchpad/ux/`):
- `navegacao-prototipo.html`: protótipo clicável (topo + menu por área, troca de área, Mensageria própria, 404, sem
  permissão, área não contratada, faixa de fatura por perfil, gaveta em 900 e 390 px, cliente "só Mensageria").
- `PROMPT_73_NAVEGACAO_ONDA1.md`: rascunho do prompt Horizons da Onda 1 (73 linhas no bloco, sem SQL novo).
- Este documento.

Conferido no `origin/main`: o SQL 45 corrige o cartão Cobrança e "Lista do dia pronta" (`/lista-do-dia` → `/fila`),
a carga com erro (`/cargas/{id}` → `/envios`) e o envio pausado (`/mensageria/lotes` → `/mensageria/{canal}/lotes`).
Ou seja, cobre o CX-01 e os três links do CX-02. Ficam dois detalhes para a Onda 2: "Ver" da carga abre a lista de
envios, e não a carga com erro; e o botão diz "Baixar", mas só abre a Lista do dia.

---

## 1. Respostas às 11 perguntas do CX

| # | Decisão | Por quê |
|---|---|---|
| 1. Mensageria: área própria ou seção? | **Área própria** (decisão do dono). Em `/mensageria/*` o menu é sempre o da Mensageria, para todos. Os menus da Cobrança e da Jornada perdem o bloco Mensageria. Quem também tem Mensageria vê só um atalho "Respostas dos clientes ↗", porque o perfil Operação trabalha a Lista do dia e as respostas. | Mostrar o menu da Cobrança para quem comprou só Mensageria vende um produto que o cliente não tem (CX-03). Ter um menu só por área elimina a dúvida "onde estou". |
| 2. Menu pela rota ou pela frente? | **Pela rota.** Uma função `areaDaRota()` decide o menu, a cor e o nome da área. O tema já tem uma (`tema-provider`, função `d()`), que passa a ser a única. As telas compartilhadas `/clientes`, `/painel` e `/mapa` pertencem à Cobrança. A Jornada passa a usar só telas `/jornada/*` (Visão geral, Lista do dia, Enviar carga, Momentos, Mensagens, Carteiras) e Relatórios com `?produto=jornada`. Ao entrar numa rota da Cobrança ou da Jornada, a frente é ajustada sem gravar preferência. | É a causa de CX-04 e CX-11: o mesmo clique dá resultados diferentes conforme o caminho. Com a rota mandando, Áreas ▾, Início, Assistente, ⌘K e link colado se comportam igual. Versões próprias de Clientes e Painel na Jornada ficam para a Onda 3, com protótipo antes. |
| 3. Depois do login: Início ou área guardada? | **PERGUNTAR AO DONO.** Opções: (a) sempre o Início; (b) a área guardada, como diz o prompt 68. **Recomendo (a):** o "Para hoje" traz fatura vencendo, chamado esperando e envio pausado, que é o que faz o cliente agir (e pagar). Com (a), a tela "Escolha a área" e a preferência "Área que abre primeiro" deixam de ser necessárias (a troca de área vem da rota). Se o dono preferir (b), a preferência fica **na conta** (`perfis.frente_preferida`), não no aparelho. | Hoje a escolha fica no navegador e se perde ao trocar de máquina (CX-17). Em qualquer opção, o login vai direto para `/inicio`, sem o salto por `/workspace`. |
| 4. O que é "contratada"? | **Módulo ativo na empresa E área liberada para a pessoa.** É o que `numeros_areas()` já calcula. O topo (Áreas ▾), o Início, a troca de área e a gaveta usam a mesma RPC. Relatórios aparece quando há pelo menos uma área contratada. | Uma regra só acaba com "contratada aqui, Quero conhecer ali" (CX-18). Para a equipe sem empresa escolhida, "Suas áreas" passa a dizer "Escolha a empresa no topo" (Onda 2). |
| 5. Onde ficam as telas órfãs? | No menu: **Canais e frases** (`/canais`) em Cobrança › Estratégia; **Radar** e **Configurar atendimento** em Mensageria › Atendimento; **Carteiras da Jornada** em Jornada › Estratégia; **Montar relatório** em Relatórios › Ferramentas (abre o modal que já existe). Pendentes de confirmação do CX: `/estrategias` (sai se a Orquestração substituiu), `/empresas` (sai se ninguém usa) e `/empresa/modulos` (redireciona para `/empresa/contratacao`). | O cliente não acha o que foi configurado na implantação (CX-16). Tela sem lugar no menu ou ganha lugar ou sai. |
| 6. Empresa: nomes e abas | **Os mesmos nomes, na mesma ordem, no Empresa ▾ e nas abas:** Dados e contatos (cadastro/CNPJ + contatos numa tela só, `/empresa`) · Pessoas e perfis · Integrações · Faturas · Contratação · Auditoria. Todas as telas da Empresa usam a mesma moldura de abas, inclusive Integrações e Auditoria. A Auditoria perde o cabeçalho da Cobrança ("Buscar cliente", seletor de carteira). Cada item continua sumindo sem a permissão. | O Admin não acha onde editar o CNPJ e vê a moldura mudar dentro da mesma seção (CX-15). "Faturas" é a palavra do cliente; a rota `/empresa/faturamento` fica como está. Onda 2. |
| 7. Bloqueio por fatura para quem não pode pagar | Quem tem `pagar_faturas` vê "Pagar agora". Quem não tem vê o mesmo aviso + "Quem paga as faturas é o Admin da sua empresa." + o link "Ver quem é o Admin" (`/empresa/pessoas`, em leitura). **Nunca** um botão para uma tela proibida. Na Onda 3, um botão "Avisar o Admin" (ver SQL na Onda 3). | Hoje o operador cai num aviso sem saída e o pagamento atrasa (CX-09). Mostrar quem resolve basta para destravar sem SQL. Depende do CX confirmar que a Operação abre Pessoas e perfis em leitura. |
| 8. Faixa de 821 a 1023 px | **Layout de celular (☰ e gaveta) até 1023 px. Um corte só, em 1024 px.** De 1024 px para cima, topo completo e menu lateral fixo. Abaixo de 600 px, a busca vira ícone e o "?" sai do topo. | Hoje são dois cortes (821 e 1024) e, entre eles, o menu some (CX-08). Um corte só é mais fácil de pedir ao Horizons e de testar. O menu recolhido só com ícones fica para a Onda 3, se o uso pedir. |
| 9. 404 e "sem permissão" | Ficam **dentro da moldura**, com o topo visível. **404:** "Esta página não existe ou mudou de endereço." + o endereço + "Ir para o Início" (principal) · "Voltar" · "Avisar o Suporte" (abre chamado com o assunto "Link quebrado: {rota}"). **Sem permissão:** "Seu perfil não abre esta tela. {Tela} é do perfil {…}. Você está como {perfil}. Quem libera é o Admin da sua empresa, em Empresa › Pessoas e perfis." + "Ir para o Início" · "Ver o que meu perfil pode". **Área não contratada:** "{Área} não faz parte do plano da sua empresa." + "Quero conhecer" · "Ir para o Início". | Cada link quebrado vira beco sem saída (CX-07). O texto de permissão segue o padrão do prompt 69 (CX-22). O "Avisar o Suporte" transforma link quebrado em chamado com endereço, o que dá retorno de qualidade. |
| 10. Relatórios | **Abre no produto de onde a pessoa veio.** Os menus mandam `?produto=` (orquestracao, jornada, mensageria), que a tela já lê. Sem parâmetro: Cobrança, depois Jornada, depois Mensageria, conforme o contratado. O canal **fica na URL** (`&canal=sms`) e vira filtro na Onda 2. Relatórios é uma área com menu próprio: Por área + Montar relatório. | Resolve CX-13 sem mexer na tela (só nos links). Filtro na URL deixa o link compartilhável e faz o redirecionamento `/mensageria/:canal/relatorios` funcionar (CX-12). |
| 11. "?" do topo | **Abre o glossário "O que significa"** (prompt 43). A Documentação continua no avatar. | É o que o prompt 68 aprovou, e evita dois atalhos para o mesmo lugar (CX-23). Onda 2. |

### Decisões que só o dono pode tomar (resumo)
1. **Depois do login** (pergunta 3): (a) sempre o Início; (b) a área guardada. Recomendo (a).
2. **Tokens de API esta semana** (CX-05): (a) rodar agora o prompt 63, que já está escrito, se o SQL 41 e a função
   `api` estiverem no banco; (b) esperar a Onda 2. Recomendo **(a) se algum cliente pagante integra por API nesta
   semana**; senão (b), e trocar o passo "Criar token" dos Primeiros passos por "Fale com o Suporte para integrar".
3. **Marca no autenticador** (CX-20): trocar o nome "MotorCob" por "MotorCX" vale só para quem ativar a verificação
   em duas etapas depois da troca; quem já ativou continua vendo "MotorCob" até renomear a conta no app (o código
   continua funcionando). Opções: (a) trocar e avisar no sino; (b) trocar sem avisar. Recomendo (a). O domínio
   `motorcob.online` e os remetentes de e-mail não entram nesta proposta, mas o dono precisa decidir se mudam.
4. **Jornada sem Clientes e Painel** (pergunta 2): na Onda 1, os itens saem do menu da Jornada porque abrem telas da
   Cobrança. Opções para a Onda 3: (a) versões próprias da Jornada; (b) só os números na Visão geral `/jornada`.
   Recomendo (b), que é menor, e (a) só se algum cliente da Jornada pedir.

---

## 2. Navegação corrigida

### 2.1 Modelo
- **Workspace** (sem menu lateral): Início, Empresa, Suporte, Minha conta, Documentação, Assistente › Minhas.
- **Áreas** (com menu lateral): **Cobrança**, **Jornada do Cliente**, **Mensageria**, **Relatórios**.
- **Console** (equipe): fica como está.
- Barra do topo igual em tudo: `MotorCX · Início · {Área atual ou "Áreas"} ▾ · Empresa ▾ · Suporte (n) · busca ⌘K ·
  ? · sino · avatar`. Dentro de uma área, o botão Áreas mostra o nome dela e fica marcado.

### 2.2 O que define o menu lateral: a rota
`areaDaRota(pathname)`, uma função só, usada pelo menu, pelo tema e pela gaveta:

| Rota | Área |
|---|---|
| `/mensageria/*` | Mensageria |
| `/jornada/*` | Jornada do Cliente |
| `/relatorios/*` | Relatórios (cor neutra) |
| `/inicio`, `/empresa/*`, `/conta/*`, `/suporte/*`, `/docs/*`, `/documentacao`, `/assistente/*` | Workspace (neutro, sem menu) |
| `/console/*` | Console (como hoje) |
| `/fila`, `/clientes`, `/cliente`, `/acoes`, `/envios`, `/orquestracao`, `/personas`, `/clusters`, `/credores/*`, `/canais`, `/mapa`, `/comite`, `/painel`, `/estrategias/*` | Cobrança |
| qualquer outra | 404 dentro da moldura |

A frente (`motorcob`/`motorcli`) vira detalhe interno. Ao abrir uma rota da Cobrança ou da Jornada, o site ajusta a
frente sozinho, sem gravar preferência. Ela nunca decide o menu.

### 2.3 Conteúdo de cada menu
Topo de todos os menus: **‹ Início** · nome da área (com a cor dela) · **troca de área** (botões só com as áreas
contratadas + Relatórios, uma vez só). Item que leva para outra área tem **↗**.

- **Cobrança.** Operação: Lista do dia · Clientes · Ações · Enviar carga. Estratégia: Orquestração · Personas ·
  Segmentos · Carteiras · Canais e frases · Mapa da Esteira · Comitê. Resultados: Painel · Relatórios ↗. Atalho (com
  Mensageria): Respostas dos clientes ↗.
- **Jornada do Cliente.** Jornada: Visão geral (`/jornada`) · Lista do dia · Enviar carga. Estratégia: Momentos e
  fases · Mensagens por momento · Carteiras. Resultados: Relatórios ↗. Atalho (com Mensageria): Respostas dos
  clientes ↗.
- **Mensageria.** Seletor de canal em pílulas, só com os canais contratados (sem seletor quando há um canal só; nunca
  `sms` como padrão). Canal {nome}: Painel do canal · Campanhas · Lotes · Templates · Listas · Score (só SMS) ·
  Configurações do canal. Atendimento: Respostas · Radar · Configurar atendimento. Resultados: Relatórios ↗.
- **Relatórios.** Por área: Cobrança · Jornada · Mensageria (só as contratadas). Ferramentas: Montar relatório.

Página inicial de cada área (usada por Áreas ▾, Início, troca de área e gaveta): Cobrança `/fila` · Jornada
`/jornada` · Mensageria `/mensageria` (com um canal só, vai direto para `/mensageria/{canal}`) · Relatórios
`/relatorios`.

### 2.4 Quem tem uma área só
- A troca de área mostra só o que a pessoa tem: a área dela + Relatórios. Não aparece "Quero conhecer" dentro do menu.
- Áreas ▾, o Início e a gaveta mostram as outras áreas esmaecidas, com "Quero conhecer".
- Endereço de área não contratada (por exemplo, `/fila` para quem tem só Mensageria) abre "{Área} não faz parte do
  plano da sua empresa.", com "Quero conhecer" e "Ir para o Início".
- Canal não contratado (`/mensageria/sms` para quem tem só WhatsApp): "O canal SMS não está contratado." + botão para
  o canal certo.

### 2.5 Erros com saída
404, sem permissão e área não contratada: ver a pergunta 9. Todas ficam com o topo visível. Sem permissão mantém o
menu lateral da área.

### 2.6 Larguras
| Largura | Topo | Menu da área |
|---|---|---|
| ≥ 1024 px (desktop) | Completo | Lateral fixo, 236 px |
| 600–1023 px (tablet) | ☰ · MotorCX · busca · sino · avatar | Na gaveta |
| < 600 px (celular) | ☰ · MotorCX · ícone de busca · sino · avatar | Na gaveta |

A gaveta (☰) é **uma só** no Workspace e nas áreas: Início · Áreas · Empresa · Suporte (n) e, dentro de uma área, uma
linha separadora e o menu da área (com o seletor de canal). Fecha ao navegar, no × e no Esc. Sem rolagem lateral em
390 px (conferido no protótipo).

### 2.7 "MotorCob" → "MotorCX"
- Todo texto que o cliente vê diz **MotorCX**: títulos de aba ("{tela} · MotorCX", prompt 72), "Suporte MotorCX",
  "Equipe MotorCX", "Padrão MotorCX", textos da Mensageria e documentação da API (inclusive "Minha conta › Tokens de
  API" → "Empresa › Integrações").
- No autenticador, o nome passa a ser "MotorCX" para quem ativar depois da troca (ver decisão 3 do dono).
- Os códigos internos (`motorcob`, `motorcli`, `mc-frente`) e o domínio ficam como estão; nunca aparecem na tela.
- Um prompt só, de varredura (Onda 2), com a lista dos 73 módulos do CX como roteiro de conferência.

---

## 3. Ondas

Regra: mudança de UX passa pelo protótipo antes. O `navegacao-prototipo.html` precisa do "aprovado" do dono antes
do prompt 73.

### Onda 1: para faturar esta semana
Só entra o que bloqueia ou confunde o cliente pagante.

| # | O quê | Onde | Resolve |
|---|---|---|---|
| 1.1 | Rodar o SQL 45 (já na `main`) e conferir no Início: Cobrança › Abrir, Lista do dia, carga com erro, envio pausado | banco (dono) | CX-01, CX-02 |
| 1.2 | Rodar os prompts 71 e 72 (já escritos), pré-requisito do 73 | site | (erros 400/404 do Supabase, testes de 22/10) |
| 1.3 | Dono aprova o protótipo `navegacao-prototipo.html` | — | — |
| 1.4 | Prompt 73: a rota define a área, quatro menus, Mensageria própria, Jornada sem telas da Cobrança, troca de área uma vez só, cores pela rota | site | CX-03, CX-04, CX-11 (parte), CX-19, CX-21 |
| 1.5 | Prompt 73: canal só entre os contratados; link do lote corrigido | site | CX-14, CX-06 |
| 1.6 | Prompt 73: Áreas ▾ com a mesma regra do Início; Relatórios abre no produto de origem; telas órfãs com lugar no menu | site | CX-18 (parte), CX-13, CX-16 (parte) |
| 1.7 | Prompt 73: 404, sem permissão e área não contratada com saída | site | CX-07, CX-22 |
| 1.8 | Prompt 73: um corte só em 1024 px e uma gaveta só | site | CX-08, CX-10 |
| 1.9 | Prompt 73: faixa de fatura conforme a permissão | site | CX-09 |
| 1.10 | **Condicional (decisão 2 do dono):** prompt 63 (tokens), se o SQL 41 e a função `api` estiverem no banco | site | CX-05 |

SQL novo na Onda 1: **nenhum**, além do SQL 45.

### Onda 2: próximas duas semanas (atrito e confiança)
| O quê | Onde | Resolve |
|---|---|---|
| Ler os parâmetros dos links profundos: `?fatura=` (destaca a fatura), `?token=` (abre a troca), `?filtro=sem_dono`, `?canal=` em Relatórios e Atendimento | site | CX-12 |
| Assistente: "Abrir módulos" → Contratação; rotas novas para auditoria e respostas (com canal) | site | CX-25 |
| Empresa unificada: nomes e abas iguais, moldura de abas em Integrações e Auditoria, Auditoria sem o cabeçalho da Cobrança, `/empresa/modulos` → `/empresa/contratacao` | site | CX-15 |
| Login direto para `/inicio`; sai "Escolha a área" (ou a preferência passa para a conta, conforme a decisão 1 do dono) | site | CX-17 |
| Varredura MotorCob → MotorCX (inclusive autenticador e documentação da API) | site | CX-20 |
| "?" abre o glossário | site | CX-23 |
| "Suas áreas" vazio para a equipe: "Escolha a empresa no topo" | site | CX-18 (resto) |
| Telas órfãs restantes: `/estrategias`, `/empresas`, `/relatorios/novo` (sair ou redirecionar, depois da confirmação do CX) | site | CX-16 (resto) |
| **SQL (descrição):** em `para_hoje`, a carga com erro aponta para `/envios?carga={id}`, e o site abre a carga; o item da Lista do dia muda a ação para "Abrir" (ou o site passa a baixar ao receber `/fila?baixar=1`) | banco + site | CX-02 (resto) |

### Onda 3: acabamento e versões próprias
| O quê | Onde | Resolve |
|---|---|---|
| Jornada: números de Clientes e Painel na Visão geral, ou telas próprias (decisão 4 do dono, com protótipo) | site (e talvez banco) | CX-11 (resto) |
| Minha conta no celular: trocar de aba sem recarregar a página | site | CX-24 |
| **SQL (descrição):** função `avisar_admin_fatura(empresa)`, que cria aviso no sino e e-mail para quem tem `pagar_faturas`, no máximo uma vez por dia por empresa, e devolve "Avisamos o Admin às {hora}". O site põe o botão "Avisar o Admin" na faixa | banco + site | CX-09 (melhoria) |
| Relatórios lembra a última aba vista, quando não vem `?produto=` | site | CX-13 (melhoria) |
| Menu lateral recolhido (só ícones) entre 1024 e 1279 px, se o uso pedir | site | CX-08 (melhoria) |

---

## 4. Perguntas de volta para o CX
Preciso que o CX confirme no código antes de fechar o prompt 73.

1. **Canais contratados:** de onde a tela `/mensageria` (`mensageria-index`) tira os canais "Indisponível"/contratados:
   `empresa_modulos.canais`, uma RPC ou outra coisa? O cliente consegue ler isso (RLS)? É a fonte que o menu vai
   usar para o seletor de canal.
2. **Frente além do menu:** a frente (`useFrente`/`mc-frente`) filtra dados (Lista do dia, carteiras, seletor de
   carteira no cabeçalho, `/clientes`, `/painel`)? A troca automática pela rota tem efeito colateral (recarregar,
   limpar a carteira escolhida, gravar no `localStorage`)? O 2º argumento de `p('motorcob', !1)` na gaveta é "não
   gravar preferência"?
3. **Cliente só de Mensageria:** o que `minhas_frentes()` devolve para ele (vazio ou `motorcob` padrão)? E o Áreas ▾
   de hoje mostra a Cobrança como contratada para ele?
4. **Mensageria por pessoa:** `pessoas.areas` só tem cobranca/jornada. Existe forma de tirar a Mensageria de uma
   pessoa, ou é só módulo da empresa + `enviar_mensagens`? Isso define o "contratada" da Mensageria.
5. **Permissões:** a lista do `role-gate` (Comitê, Auditoria, Enviar carga, Painel e outras), com os perfis que
   abrem cada tela, para o texto "{Tela} é do perfil {…}". E: a Operação abre `/empresa/pessoas` em leitura? Se
   não, o link "Ver quem é o Admin" (faixa de fatura) vira beco e eu troco o texto.
6. **Faixas de bloqueio:** quais existem no `app-shell` (fatura vencida, acordo, bloqueio total), o que cada uma
   realmente bloqueia (envios pausados? acesso?) e se `pagar_faturas` é a permissão certa para o "Pagar agora".
7. **Score:** `/mensageria/:canal/score` só faz sentido para SMS, ou funciona em RCS, e-mail e WhatsApp?
8. **Telas órfãs:** `/estrategias` e `/estrategias/:id` ainda são usadas ou a Orquestração (prompt 60) substituiu?
   Quem usa `/empresas`? `/relatorios/novo` é a mesma coisa que o modal "Montar relatório"? O que mostra
   `/empresa/contratacao`, para eu redirecionar `/empresa/modulos` para lá?
9. **Relatórios:** valores exatos aceitos em `?produto=` (`orquestracao`, `jornada`, `mensageria`?) e o que o
   parâmetro `exportacao` faz.
10. **Jornada:** `/clientes`, `/painel` e `/mapa` mostram algo da Jornada para um cliente só de Jornada, ou vêm
    vazias? Se mostram dados úteis, tirar do menu tira informação que só existe lá.
11. **404:** dá para pôr a rota coringa `*` dentro do layout logado (`app-shell`/`workspace-shell`), ou o servidor
    (que hoje responde 302/404) intercepta antes? Qual layout envolve as rotas sem menu?
12. **Breakpoints:** confirmar que `lg` = 1024 px no Tailwind do site e se o botão flutuante do Assistente ou algum
    botão fixo embaixo colide com a gaveta abaixo de 1024 px.
13. **Tokens (CX-05):** a tabela `api_tokens` existe (o SQL 45 já a consulta)? O SQL 41 e a função `api` foram
    rodados? Se sim, falta só publicar a tela do prompt 63.
14. **Assistente e ⌘K:** a lista completa das ações `abrir_*` e `rota()` do `assistente-context`, para eu conferir
    que nenhuma leva para rota que vira 404 depois do prompt 73.

---

## 5. Fechamento com o CX (23/10/2026)

Entrada: `cx/respostas_ao_ux.md` (14 respostas, os ajustes R1–R12 e os achados N1–N3) e as decisões do orquestrador.
**Esta seção vale mais que as seções 1 a 4 onde elas divergem.** O `PROMPT_73_NAVEGACAO_ONDA1.md` e o protótipo já
estão atualizados.

### Decisões do orquestrador
- **N2** (`ver_clientes`/`ver_painel` faltando no catálogo): resolvido no banco pelo SQL 46, com as duas permissões
  liberadas para os quatro perfis. O prompt 73 continua sem SQL próprio, mas agora diz "Rode depois do SQL 45 e do
  SQL 46". No protótipo, o Painel aparece para a Operação.
- **N1**: a troca de área pela rota usa só `aplicarFrente(f)` (sessão). Nunca `escolherFrente(f, false)`. Está escrito
  no prompt.
- **N3** (empresa só de Mensageria): fica fora da Onda 1. Saíram do prompt o cenário de teste e a lógica que dependia
  dele. Cenários de teste agora: cliente só Cobrança, cliente Cobrança + Jornada (com Mensageria SMS e RCS) e equipe
  com a pílula da empresa. No protótipo, a opção "Só Mensageria" virou "Só Cobrança (Mensageria só WhatsApp)".
- **CX-05** (tokens): sai do 73 e vira prompt à parte, depois (substitui o item 1.10 da Onda 1).
- `/empresa/modulos` → **`/empresa/integracoes`**, não `/empresa/contratacao` (que é tela do Console e manda o
  cliente para `/empresa`). Corrige a resposta 5 e a Onda 2.

### Os 12 ajustes do CX

| # | Ajuste | Como ficou no prompt 73 |
|---|---|---|
| R1 | Usar `aplicarFrente` na troca pela rota | §1: `aplicarFrente('motorcob' \| 'motorcli')`, só sessionStorage. Proibidos `escolherFrente(f, false)` e `setFrente` nessa troca. `escolherFrente` só quando a pessoa escolhe (login, Minha conta). A troca de área do menu é navegação e não grava preferência. Para a equipe, a frente da rota vence a troca automática pela pílula. Teste: navegar não muda a "Área que abre primeiro". |
| R2 | Formato de `minhas_frentes`; equipe nunca vê "fora do plano" | §1: lê `["motorcob"]` ou `[{frente}]` (`typeof x === 'string' ? x : x.frente`). A página "não faz parte do plano" vale só para cliente; a equipe nunca a vê. |
| R3 | Áreas ▾ da equipe sem depender de `numeros_areas` | §3: equipe vê todas as áreas da empresa da pílula, como hoje. Cliente: `numeros_areas` (só `area` e `contratada`), lida uma vez por empresa e guardada. Relatórios à parte (aparece com qualquer área contratada). |
| R4 | Relatórios: contratação pelas frentes | §3: sem `?produto=`, Cobrança se tem a frente motorcob, senão Jornada (motorcli), senão Mensageria (módulo). Não usar `empresa_modulos` para Cobrança/Jornada. É a única mudança dentro de uma tela, dita na abertura. `?exportacao=` continua funcionando. |
| R5 | `&canal=` e `editar_canais` | Tirei o `&canal=` (a tela não lê; o filtro por canal fica para a Onda 2, CX-12). "Canais e frases" só aparece com `editar_canais`. |
| R6 | Canais com `ativo = true` | §2: canais = `empresa_modulos.canais` da linha `mensageria` com `ativo = true`. Também ficou explícito o canal das rotas sem canal e do Assistente: o último usado, se ainda contratado, senão o 1º; nunca `sms` como padrão. "Lotes" some no WhatsApp (o banco não aceita lote de WhatsApp). |
| R7 | Score como item único | "Score de Entrega" em Mensageria › Resultados, fora do bloco do canal, para qualquer canal (a tela é por empresa). |
| R8 | `lg` = 1024 px em tudo, inclusive o menu recolhido | §4: trocar todos os `min-[821px]` (topo e gaveta) por `lg`; o recolhido (Ctrl+B, `mc-menu-recolhido`, hoje 980 px) só a partir de `lg`. |
| R9 | Faixa de bloqueio sem beco; "Pagar agora" com as duas permissões | §6: "Pagar agora" só com `ver_faturamento` E `pagar_faturas`. Sem as duas: "Quem paga as faturas é {nomes dos Admins via `pessoas_empresa`}", sem link para Pessoas e perfis (a RLS mostra à Operação só o próprio perfil). |
| R9b | Empresa suspensa/encerrada manda falar com o Suporte | §6: faixa e cartão dizem "Acesso suspenso pela equipe MotorCX. Fale com o Suporte." + "Falar com o Suporte" (`/suporte/novo?assunto=Acesso suspenso`). Nunca "fatura vencida" nem Pagar. No protótipo, o controle "Bloqueio da empresa" tem as opções Fatura vencida e Suspensa. |
| R10 | Texto "é do perfil {…}" vazio para o Painel | Resolvido pelo SQL 46. O texto lê `permissoes_catalogo` + ajustes de `permissoes_papel`. |
| R11/R12 | Cenários de teste; rotas com `/jornada`; botão do Assistente | Cenários trocados (ver N3). §1 lista `/jornada` e `/mensageria` sem barra. §4: o botão do Assistente sobe 64 px quando há botão fixo no mesmo canto (Orquestração), em qualquer largura. |

### O que muda nas seções anteriores
- **Resposta 7 / Onda 3:** sai o link "Ver quem é o Admin"; entra o nome do Admin na faixa. O "Avisar o Admin" (Onda 3) continua válido.
- **Resposta 10:** o canal não vai na URL de Relatórios até a tela ler `?canal=` (Onda 2, junto com CX-12).
- **Seção 2.3:** Score de Entrega em Resultados (item único); Lotes some no WhatsApp; Canais e frases com `editar_canais`.
- **Seção 2.4 (quem tem uma área só):** vale para cliente só Cobrança ou só Jornada. Empresa só de Mensageria precisa de decisão de produto + SQL (permitir zero frentes, ou tratar `orquestracao` à parte), fora da Onda 1.
- **Onda 1:** a sequência fica SQL 45 → SQL 46 → prompts 71/72 → aprovação do protótipo → prompt 73. Tokens (CX-05) em prompt à parte.
- **Novos para a Onda 2:**
  - Assistente/⌘K: não sugerir telas de área não contratada.
  - `/empresas` → `/console`.
  - `/relatorios/novo` sai ou redireciona para `/relatorios` com o modal aberto.
  - Avaliar "Ações" (`acoes_dia`) na Jornada.
  - Remover a faixa "acordo em dia" (código morto).
- **Antes de publicar (conferir logado):**
  - `await supabase.rpc('minhas_frentes')` no console do navegador, para ver o formato.
  - Se `/painel` mostra algo da Jornada.
  - Equipe: se a pílula de empresa não briga com a frente da rota.
