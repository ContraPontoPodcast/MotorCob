# MotorCX: auditoria de UX completa (cliente pagante e Console)

25/10/2026 · UX designer · Base: bundle publicado atual `/tmp/claude-0/site4/js` (218 módulos), CSS `/tmp/claude-0/site4/all.css`,
prompts 73 e 74 aplicados (branch `claude/navegacao-onda1`), print do dono `images/35.png`. Cópia legível que usei:
`.../scratchpad/ux/pretty4/`. Análise sem login: o que depende de dados reais está marcado **(verificar)**.

Entregas desta rodada (`.../scratchpad/ux/`):
- `PROMPT_75_SELETOR_DE_AREA_E_DEMO.md`: prompt completo, 79 linhas.
- `navegacao-prototipo.html` v3: seletor de área novo, empresa no topo, controles de tema claro/escuro e de "quem vê" (cliente ou equipe).
- Este documento.

Severidade: **Bloqueia vender** = derruba a primeira impressão numa demo ou contradiz a marca · **Alta** = o cliente
se perde, desconfia ou erra numa tarefa comum · **Média** = atrito, inconsistência visível · **Baixa** = acabamento.

---

## 1. A troca de área redesenhada

### O problema (print 35)
- No topo do menu lateral, a pílula da empresa ("MotorCob ▾") vem logo acima dos botões "Cobrança · Mensageria ·
  Relatórios".
- Esses botões (`app-shell`, função `Me`) têm o mesmo ícone de 14 px + texto + `rounded-[8px]` dos itens de
  navegação (`Oe`). Não têm contêiner, e o ativo é só `bg-black/[.08]`, que no escuro vira 9% de branco
  (`.mc-menu .bg-black/[.08]`). Resultado: parecem a primeira seção do menu.
- O menu mistura três coisas sem separação: **empresa** (contexto), **área** (onde estou) e **navegação da área**.

### Opções avaliadas
| Opção | Prós | Contras |
|---|---|---|
| A. Abas segmentadas no topo do menu | Mostra as áreas de uma vez | Quatro nomes ("Jornada do Cliente") não cabem em 236 px; com uma área a mais quebra; ainda parece navegação, que é o problema atual |
| B. Troca só no topo (Áreas ▾) e o menu com o nome da área como título | Um lugar só | Dentro da área, trocar exige subir o olho até a barra; no celular o topo vira ☰ e a troca some |
| **C. Seletor de área no topo do menu, estilo workspace switcher (Linear, Notion, Slack, Stripe)** | Padrão que o usuário B2B já conhece; um bloco com cor e ícone da área diz "você está aqui" e "clique para trocar"; escala para mais áreas; funciona igual recolhido e no celular | Um clique a mais para ver as outras áreas (aceitável: troca de área é rara perto da navegação dentro da área) |

### Decisão: C
- **Empresa (contexto) vai para a barra do topo.**
  - Equipe: pílula com ícone de prédio, ao lado do botão Console.
  - Cliente: não vê pílula, porque tem uma empresa só. O nome dela fica no menu do avatar e no subtítulo das telas.
- **Área (onde estou) vira um seletor no cabeçalho do menu:** quadrado 28 px na cor da área com o ícone branco, o
  nome em 15 px negrito e ⌄. Abre uma lista com as áreas liberadas (descrição de uma linha e ✓ na atual), as não
  contratadas separadas ("Quero conhecer"; para a equipe, "Abrir mesmo assim") e "Ir para o Início".
- **Navegação da área** vem depois de uma linha divisória. Na Mensageria, o seletor de canal fica numa faixa própria,
  com o rótulo "Canal", para não parecer item de menu.
- O "‹ Início" sai do menu lateral: o topo já tem Início, e o seletor também leva ao Início.
- Recolhido: só o quadrado colorido. Celular: o mesmo seletor dentro da gaveta.
- O Áreas ▾ da barra do topo continua, porque é a entrada a partir do Workspace (sem menu lateral) e mostra a mesma
  lista.

---

## 2. Problemas encontrados

### Bloqueia vender
| ID | Tela | O que o usuário vê | Evidência | Prompt |
|---|---|---|---|---|
| UX-01 | Todas as áreas, menu lateral | A troca de área parece item de menu; empresa, área e navegação misturadas (print 35) | `app-shell`: `Me()` usa os mesmos ícone, tamanho e raio de `Oe()`; `Ae()` (pílula da empresa) logo acima; ativo `bg-black/[.08]` quase invisível no escuro | 75 |
| UX-02 | Login, abas do navegador, site público, textos | Marca antiga em toda parte: **56 títulos de aba** "… \| MotorCob" (inclusive "Entrar \| MotorCob", "Lista do dia", "Personas", "Suporte", "Saúde"); **site público** com "MotorCob — início", "© 2026 MotorCob", "Concordo que o MotorCob use estes dados…", "Plataforma MotorCob — slides"; dentro do app, "Modelos MotorCob", "playbook MotorCob", "(formato MotorCob)", "endereços curtos do MotorCob"; "QR do autenticador MotorCob" | `grep MotorCob` em 75 módulos; `site-7oPbZJZq.js`; `login-DITblc5Z.js`; `DuasEtapas-Dsb1E6A2.js`. O prompt 72 item 5 pediu "{tela} · MotorCX" e não pegou | 75 (app e login), 76 (site e autenticador) |
| UX-03 | Tema escuro: Faturas, Pessoas, Relatórios, Contratação, Atendimento, Templates, Console | Avisos e pílulas de situação ficam em pastel claro sobre o fundo preto; links azuis quase somem | 26 classes sem versão escura. As maiores: `bg-[#FFE8E6]` (83 usos), `bg-[#E8E8ED]` (39), `bg-[#E8F8EC]` (37), `bg-[#FFF3E8]` (22), `text-[#0A60D0]` (56; contraste ≈ 2,9:1 sobre #1C1C1E, abaixo de 4,5:1). O bloco do 74 está em minúsculas; a classe CSS diferencia maiúsculas, e o bundle usa maiúsculas | 75 |
| UX-04 | Lista do dia, Orquestração, Personas, Comitê, Enviar arquivos | Com "Todas as carteiras" no seletor, a tela mostra só "Escolha o credor no topo para ver esta página." Numa demo, a vitrine (Lista do dia) abre vazia e com uma palavra ("credor") que não existe na tela | `fila-Df0JWih0.js` l.1717 e mais 4 módulos; o seletor `J()` do `app-shell` mostra "Todas as carteiras" | 75 |
| UX-05 | Pílula da empresa | O dono vê "MotorCob" como nome da empresa | `Ae()` mostra `empresa.nome`: é **dado**, não texto do site **(verificar)**. Ação do dono, fora do Horizons: no Console, renomear a empresa da casa e criar uma "Demonstração (fictícia)" com dados fictícios para as demos | Ação do dono |

### Alta
| ID | Tela | O que o usuário vê | Evidência | Prompt |
|---|---|---|---|---|
| UX-06 | Cobrança | Duas cores de botão principal: azul-petróleo nas telas da Cobrança e preto no resto. A cor da área (#8A6A2E) não aparece em botão nenhum | `bg-[#0F4C5C]` 72× (orquestração, fila, personas, canais, credores…) × `bg-[#1D1D1F]` 182×. A paleta antiga (#0f4c5c/#163943/#eaf2f3) domina 19 módulos (orquestração 284 ocorrências) | 77 |
| UX-07 | Menu × título × aba | O mesmo lugar com nomes diferentes: menu "Segmentos" × aba "Clusters", "Excluir cluster", "Clientes por cluster"; menu "Carteiras" × aba "Credores", "Todos os credores", "Abrir configurações do credor"; menu "Enviar carga" × tela "Enviar arquivos"; Empresa ▾ "Faturas" × aba "Faturamento"; login fala em "frente" | `clusters-*`, `credores-*`, `envios-*`, `empresa-shell-*`, `login-*` | 75 (credor, frente), 78 (resto) |
| UX-08 | Áreas (cliente) | A empresa aparece duas vezes: pílula no menu (para o cliente é um `span` que parece botão, sem função) e subtítulo "empresa · carteira · data" no cabeçalho | `Ae()` com `!e?.equipe` → `span` com o mesmo estilo do botão; `X()` monta `[empresa, carteira, data]` | 75 |
| UX-09 | Lista do dia, Orquestração, Clientes | Jargão sem explicação na tela: "CPC A/B", "Deu CPC", "Não CPC", "raia", "estoque", "esteira", "Reenquadrar agora", "contato HOT", "com status_contato" (nome de coluna), "bureau", "playbook" | `fila-*`, `orquestracao-*`, `clientes-*`, `personas-*` | 78 |
| UX-10 | Telas vazias (empresa nova ou demo) | Vazios secos sem próximo passo: "Sem dados.", "Nada aqui.", "Nenhum lote encontrado.", "Sem dados de clusters na última rotina.", "Sem ranking de canais.". Só a Lista do dia e a Jornada têm "Enviar a primeira carga" | `personas-*`, `clusters-*`, `lotes-lista-*`, `console-assistente-*` | 77 |
| UX-11 | Equipe (demo feita pelo dono) | Sem empresa escolhida, 17 telas abrem com "Escolha a empresa no topo para ver esta página." e a pílula fica no menu lateral, não no topo | `grep "Escolha a empresa no topo"`: 17 módulos; `Ae()` | 75 |
| UX-12 | Página de qualquer área | Duas buscas lado a lado: "Busque uma tela ou pergunte ao Assistente" (topo, ⌘K) e "Buscar cliente" no cabeçalho de toda tela da Cobrança | `J()` no `app-shell`; topo no `assistente-gaveta` | 79 |

### Média
| ID | Tela | O que o usuário vê | Evidência | Prompt |
|---|---|---|---|---|
| UX-13 | Excluir/apagar (Templates, Persona, Contato, Relatório, Lista, Mensagens da Jornada, Duas etapas) | Caixa nativa do navegador ("Excluir o modelo…?", "Desligar a verificação em duas etapas?"), fora do padrão de confirmação do prompt 49 e sem dizer a consequência | `window.confirm`/`confirm(` em 13 módulos | 77 |
| UX-14 | Títulos de página | Sete tamanhos de título: 28 bold, 22 bold, 20 semibold, 26, 24, 30, 32 | `grep text-[NNpx] font-bold` | 77 |
| UX-15 | Carregando | "Carregando..." (63), "Carregando…" (8), "Carregando informações...", "Rodando relatório…": texto solto, sem esqueleto; a tela pisca | `grep Carregando` | 77 |
| UX-16 | Suporte e editor de estratégia no celular | Tabela larga sem rolagem nem cartões em 390 px (o prompt 70 pediu cartão por chamado) | `suporte-BfhwTzre.js`, `estrategia-editor-core-*`: `table` sem `overflow-x-auto` | 79 |
| UX-17 | Console | Abas "\| MotorCob" (Saúde, Implantação); filtros do Assistente "MotorCob/MotorCli" usando o nome antigo como nome de área | `console-saude-*`, `console-implantacao-*`, `console-assistente-*` | 75 (filtros), 76 (abas restantes) |
| UX-18 | Minha conta › Segurança | "Inativo. Ligue para pedir o código a cada entrada.": "Ligue" lê como "telefone" | `conta-CHffpKOi.js` | 78 |
| UX-19 | Rodapé das áreas | "© MotorCX · Gestão de contatos" diminui o produto (é cobrança e CX, não "gestão de contatos") | `app-shell` rodapé | 76 |
| UX-20 | Empresa › Visão geral | "Ficha da empresa" com "Responsável pela venda" e "Gerente da conta": termos internos para o cliente **(verificar se o cliente vê)** | `empresa-DMUOG2it.js` | 78 |
| UX-21 | Seletor de canal (Mensageria) | Pílulas de canal acima dos itens, com o mesmo peso visual de navegação | `ke()` no `app-shell` | 75 |
| UX-22 | Faixas de acordo/bloqueio | Faixa vermelha ou laranja de ponta a ponta com texto branco 14 px; em 390 px vira três linhas acima do conteúdo | `app-shell` l.1590–1660 | 79 |

### Baixa
| ID | Tela | O que o usuário vê | Evidência | Prompt |
|---|---|---|---|---|
| UX-23 | Raios de canto | Quatro escalas misturadas (`rounded-lg/xl/2xl` + `[7/9/10/12px]`) | contagem no bundle | 77 |
| UX-24 | Lotes (lista) | Cabeçalhos com espaço no fim ("Data ", "Total "), provavelmente o lugar da seta de ordenação | `lotes-lista-*` | 79 |
| UX-25 | Duas etapas | `window.confirm("Desligar a verificação em duas etapas?")` sem dizer o risco | `conta-*` | 77 |

**Conferido, sem problema:**
- a caixa de atendimento mostra só `destino_mascara` (sem telefone completo);
- os caminhos de arquivo do bureau não aparecem na tela;
- a 404 e o "sem permissão" do 73 estão publicados (`app-not-found`, `role-gate`);
- o deslocamento do botão do Assistente existe (`assistente-gaveta`, `calc(5.5rem …)`).

---

## 3. Pacotes de prompts (cada um com menos de 100 linhas)

Ordem: primeiro o que o cliente vê nos cinco primeiros minutos de uma demo (login → Início → Lista do dia →
Mensageria → tema escuro).

| Prompt | Conteúdo | IDs |
|---|---|---|
| **75** (escrito) | Seletor de área; empresa no topo (equipe) e fora do menu (cliente); equipe lembra a última empresa; "Escolha a carteira" com botões; marca MotorCX nas abas, textos do app e login; tema escuro das pílulas, avisos e links | UX-01, 02 (app), 03, 04, 08, 11, 17 (filtros), 21 |
| **76** Marca no site público e no autenticador | Site público (`site-*`): todo "MotorCob" → "MotorCX", título, rodapé, formulário de contato ("Concordo que o MotorCX…"), slides; autenticador: nome "MotorCX" para quem ativar depois (decisão do dono de avisar no sino); privacidade; rodapé "© MotorCX · Cobrança e experiência do cliente"; documentação (docs, docs-api) | UX-02 (resto), 17 (abas), 19 |
| **77** Um sistema visual | Botão principal único (neutro: texto principal sobre cartão) em todas as áreas; tira o azul-petróleo #0F4C5C/#0d4252 dos botões e destaques da Cobrança (vira o neutro ou a cor da área só em identidade); um componente de cabeçalho de página (título 28 px bold, subtítulo, ações) em todas as telas; raios 8/12/999; confirmação do prompt 49 no lugar dos `confirm()`; esqueleto de carregamento padrão; estado vazio padrão (ícone, frase, próximo passo com botão) aplicado nas telas da lista | UX-06, 10, 13, 14, 15, 23, 25 |
| **78** Vocabulário | Menu = título = aba: Segmentos (não "cluster"), Carteiras (não "credor"), Enviar carga, Faturas; glossário (i) do prompt 43 nos termos CPC, esteira, raia, estoque, reenquadrar, bureau, playbook→padrão; "contato HOT" → "contato principal"; tirar "status_contato"; "Ligue" → "Ative"; revisar termos internos na Ficha da empresa | UX-07 (resto), 09, 18, 20 |
| **79** Celular e densidade | Suporte e editor de estratégia em cartões abaixo de 600 px; "Buscar cliente" sai do cabeçalho e entra no ⌘K ("Cliente 12345" abre o extrato); faixas de bloqueio compactas no celular (uma linha + botão); cabeçalhos de tabela sem espaço solto | UX-12, 16, 22, 24 |
| **80** Console | Revisão do Console com a mesma régua: abas e textos MotorCX, Empresas com estado vazio e próximo passo, Implantação com legenda dos passos, Assistente em linguagem de produto | UX-17 e o que o CX achar na conferência |

Fora do Horizons (dono): renomear a empresa "MotorCob" no Console e montar uma empresa de demonstração com dados
fictícios (UX-05).

---

## 4. Para o CX verificar no código (antes do 75)
1. **Nome "MotorCob" na pílula:** é `empresas.nome` de uma empresa real da casa ou de teste? Qual empresa a equipe usa nas demos?
2. **Onde o tema escuro mapeia classes hoje:** confirmar que o bloco `[data-tema=escuro] .mc-platform` do 74 está todo em minúsculas, enquanto o bundle usa `bg-[#FFE8E6]` etc. em maiúsculas (a classe CSS diferencia). E se existe outro lugar (o `tema-provider` injeta `:root{}`/`[data-tema="escuro"]{}`) onde dá para mapear melhor.
3. **Seletor de carteira com "Todas as carteiras":** quais telas aceitam ver todas (Clientes, Painel?) e quais exigem uma (Fila, Orquestração, Personas, Comitê, Envios)? O `selectCredor` grava em localStorage por empresa?
4. **Ícones lucide disponíveis no bundle:** Wallet, Route, MessageSquare, BarChart3 e Building2 já estão importados (`app-shell` usa `v`, `y`, `w`, `_`, `g`)? Quais nomes correspondem a cada letra?
5. **Menu recolhido:** quando `mc-menu-recolhido` = 1, o popover pode sair do `aside` (`overflow-y-auto` no `nav` corta?).
6. **Equipe e a última empresa:** o `auth-provider` já guarda a empresa escolhida em algum lugar (`selectEmpresa`)? Para não criar uma segunda chave.
7. **Ficha da empresa:** "Responsável pela venda" e "Gerente da conta" aparecem para o cliente ou só para a equipe?
8. **`confirm()` nativos:** confirmar a lista dos 13 módulos e se o componente `confirma-acao` (prompt 49) aceita o texto da consequência.
9. **Títulos de aba:** de onde vem o "| MotorCob" (o `meta` de cada rota no manifest ou um helper comum)? Se for um helper, o 75 corrige tudo de uma vez.
10. **Site público:** `site-7oPbZJZq.js` é a página `/` de motorcob.online que o prospect vê? Há outra página de vendas fora do Horizons?

---

## 5. Fechamento com o CX (75)

Entrada: `cx/respostas_ux_75.md`. Esta seção vale mais que as anteriores onde elas divergem. Arquivos finais:
`PROMPT_75_SELETOR_DE_AREA_E_DEMO.md` (88 linhas) e `PROMPT_76_SITE_PUBLICO_MARCA.md` (53 linhas). Os dois saem juntos.

### Correções à auditoria
- **UX-01:** a linha de áreas do 74 foi aplicada (`Me()` com `aplicarFrente`). O problema é visual, não falta de código.
- **UX-02:** no navegador, as abas já mostram "· MotorCX" (o `root` corrige o `<title>` com um `MutationObserver`). O que continua errado:
  - o HTML que o servidor manda (`<title>`, `og:title`, `twitter:title`, `description`): prévia de link no WhatsApp e no Google;
  - os textos visíveis;
  - os nomes de frente ("MotorCob"/"MotorCli") no login, no Início e no Workspace.

  A severidade continua.
- **UX-11:** hoje a equipe tem duas pílulas, uma no topo (`q`) e outra no menu (`Ae`).
- **UX-16:** a lista do Suporte já tem cartões no celular. Sai do 79; o 79 confere só o editor de estratégia.
- **N2 / SQL 46:** já rodado pelo dono (`ver_painel` e `ver_clientes` no catálogo). Não está mais pendente.
- **Tokens de API (CX-05):** continua sem tela. Fica em prompt próprio (republicar o 63), fora do 75/76.

### Os 11 ajustes e como ficaram
| # | Ajuste do CX | Como ficou |
|---|---|---|
| 1 | Última empresa da equipe | 75 §2: usa a chave existente `mc-empresa` (auth-provider); só deixa de apagar ao sair. Sem chave nova. |
| 2 | Pílula | 75 passo 1.1 remove `Ae` do menu. §2 muda o estilo da pílula que já existe no topo (`q`) e proíbe criar outra. |
| 3 | Gaveta | 75 passo 1.6: Empresa com Dados e contatos, Pessoas e perfis, Integrações, Faturas e Auditoria, com as permissões de hoje. |
| 4 | `frentes.nome` | 75 §4.3: cartões do login, pílula do Início ("Cobrança") e aviso do Workspace mostram o nome da área; ids intactos. O logo do login com frente fica só "MotorCX". |
| 5 | Títulos | 75 §4.1: a troca é feita no helper `seo` (title, og, twitter e description) e depois no `meta` de cada rota. O corretor do `root` fica como rede de segurança. |
| 6 | Regra geral de marca | 75 §4.2: todo "MotorCob" visível vira "MotorCX" e "MotorCli" vira "Jornada do Cliente". Exceções: ids, `empresas.nome`, o fator do autenticador e o site público (os dois no 76). Aceite em §4.4: nenhuma ocorrência visível, inclusive no view-source de /login e /fila. |
| 7 | `credor` na API | 75 §3: a troca não vale em docs-api, /documentacao e nomes de parâmetro ou campo (`?credor=`, `credor_id`, escopos). |
| 8 | Envios | 75 §3: os cartões "Escolha a carteira" ficam só em Lista do dia, Orquestração, Personas e Comitê (clicar chama `selectCredor`). Em Enviar arquivos, troca só a palavra. |
| 9 | Tema escuro | 75 §5: bloco de CSS pronto para colar, no padrão `.mc-platform .classe` → variáveis que já existem (`--estado-erro-fundo`, `--estado-pronto-fundo`, `--estado-atencao-fundo`, `--estado-info-fundo`, `--estado-info`, `--estado-erro`, `--estado-pronto-texto`, `--base-fill`, `--base-cartao`, `--base-borda`). Classes em maiúsculas como no bundle, com as variantes `hover:` e `border-`. Cinzas, âmbares e `#FFE08A` ficam presos a `[data-tema=escuro]`, para o claro não mudar nada. Aceite: `grep "FFE8E6"`/`"0A60D0"` no CSS publicado. |
| 10 | Cores e ícones das áreas | 75 passo 1.3: as variáveis `--area-cobranca/jornada/mensageria/neutro` ganham versão escura. Texto explícito: "Jornada: trocar Compass por Route" e "Relatórios ChartColumn". |
| 11 | Menu suspenso e passos | 75 passos 1.1–1.7: menu suspenso em portal (`createPortal` no body) com `z-[70]`. A remoção virou passos numerados, com aceite em 1.7: "o aside não tem nenhum botão ou link com o nome de uma área fora do seletor, nem pílula de empresa". |

### Prompt 76 (site público e autenticador)
- **motorcob.online `/`:** os 9 "MotorCob" visíveis viram MotorCX: logo, aria-label, textos, "Suporte", slides, consentimento do formulário e rodapé com o ano da data. Título, descrição, og e twitter continuam MotorCX. Estrutura e seções iguais.
- **Imagem de prévia:** `og:image` aponta para `og-motorcob.jpg`. Se a imagem tiver a marca antiga, o dono sobe a `og-motorcx.jpg` e o prompt troca o link.
- **motorcli.online:** fica como está; só corrige título que diga MotorCob (hoje: "MotorCli · Jornada do Cliente, uma frente do MotorCX", que está certo).
- **Autenticador, SÓ SE O DONO APROVAR:**
  - `issuer: 'MotorCX'` e `friendlyName` "MotorCX {data}" no `auth.mfa.enroll`.
  - Textos da tela de duas etapas corrigidos.
  - Aviso para quem já cadastrou: (a) faixa em Minha conta › Segurança, sem banco; ou (b) aviso no sino, que exige SQL à parte.
- **Rodapé das áreas:** "Cobrança e experiência do cliente" no lugar de "Gestão de contatos".

### Ações do dono, fora do Horizons
- Renomear a empresa "MotorCob" no Console e criar uma empresa de demonstração com dados fictícios (UX-05).
- Conferir o que a `og-motorcob.jpg` mostra; se tiver a marca antiga, subir a `og-motorcx.jpg`.
- Decidir o item 4 do 76 (autenticador) e, se aprovar, entre (a) faixa e (b) sino.
- Conferir logado, antes da demo, que Painel e Clientes aparecem no menu da Cobrança (SQL 46).
