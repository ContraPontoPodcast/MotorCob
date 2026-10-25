# CX → UX: conferência do PROMPT_75 v2 (trilho, cabeçalho e abas)

25/10/2026 · Fontes: bundle `/tmp/claude-0/site4/js` (cópia legível `scratchpad/ux/pretty4/`) e `site4/all.css`. Sem login.

Legenda: **confirmado** · **suspeita** · **precisa de login**.

## Respostas às 9 perguntas

### 1. Molduras com cabeçalho ou abas próprias: confirmado, várias duplicam

| Moldura | O que desenha hoje | Conflito com o 75 |
|---|---|---|
| `app-shell` | Menu lateral (`aside.mc-menu`) com os menus da Cobrança, da Jornada e da Mensageria **e o menu do Console** (`_e`: Empresas, Saúde, Implantação, Carteiras, Atendimento, Assistente, Faturamento, Margem, Produtos, Fornecedores, Qualidade, Filtro, Equipe, Auditoria, E-mails). Também a seleção de canal (`ke`), as faixas de fatura/acordo, a página "não faz parte do plano" e o cabeçalho `X` (com `Y()` = "Buscar cliente" + seletor de carteira). | Tirar o aside sem dar abas ao Console deixa **as 15 telas do Console sem navegação** (só o `/console`). O §3 não lista o Console. |
| `workspace-shell` | Só o topo (`assistente-gaveta`), sem cabeçalho de página. O `h1` só aparece nos estados de erro e acesso. Exporta um cabeçalho próprio (`T`) que as telas do Workspace usam. | O §2 manda todas as telas usarem o `X` do `app-shell`; as do Workspace usam outro componente. |
| `console-shell` (15 módulos) | Faixa própria com `h1` "Console MotorCX", a função da pessoa ("Master"…), "Só a carteira · N empresas", o número de não resolvidos e "Equipe MotorCX · data". | Duplica com a faixa de contexto e com o cabeçalho do §2. |
| `jornada-shell` (6 módulos) | Cabeçalho próprio `f({title, linha, actions})` com `h1` e o seletor **Carteira** (só carteiras `frente = motorcli`), mais o vazio "Nenhuma carteira da Jornada". | Duplica com o `X`. O seletor de carteira da Jornada não é o do `app-shell`. |
| `mensageria-canal-layout` | `h1` por subtela ("Lotes do dia", "Campanhas"…), a pílula **Simulação / Envio real**, o subtítulo "empresa · Mensageria · canal · data", a faixa "Pedir envio real" e o rodapé "Trocar de canal". | Duplica o título e o canal (o §3 põe o canal em pílulas abaixo das abas). |
| `empresa-shell` (6 módulos) | `h1` da empresa, abas próprias (Visão geral · Contatos · Pessoas e perfis · Integrações · Faturamento · Contratação), menu "Mais ações" e as ações da equipe (suspender, liberar…). | O §3 substitui as abas (certo), mas precisa dizer que o "Mais ações" e as ações da equipe ficam. "Visão geral" (`/empresa`, a Ficha) some da lista de abas do §3. |

Fora das molduras, desenham o próprio `h1` (não usam `X`): `home`, `conta`, `relatorios`, `montar-relatorio`, `suporte-detalhe`, `suporte-novo`, `mensageria-atendimento`, `mensageria-radar`, `mensageria-config-atendimento`, `mensageria-score`, `mensageria-index`, `mensageria-campanha-detalhe`, `estrategia-editor-core`, `docs-*`, `documentacao`, `role-gate`, `app-not-found`. Usam o `X`: 20 telas (Ações, Canais, Cliente, Segmentos, Comitê, Configurações da carteira, Carteiras, Auditoria, Empresas, Estratégia(s), Lista do dia, Mapa, Orquestração, Painel, Minhas perguntas). Personas, Clientes, Enviar arquivos e as telas da Jornada **não** usam.

### 2. Mais de uma ação principal: confirmado por amostra, conferir na tela
- Nos cabeçalhos `X` lidos (Lista do dia, Segmentos, Carteiras, Estratégias, Empresas, Auditoria, Orquestração), o normal é **uma** ação escura.
- O excesso está fora do cabeçalho:
  - **Orquestração:** além da ação do cabeçalho, botão fixo "Salvar" (`fixed bottom-6 right-6 z-40`, `bg-[#0F4C5C]`).
  - **Lista do dia e Clientes:** o botão "Reenquadrar agora" (`reenquadramento-button`, importado por `clientes` e `orquestracao`).
  - **Todo cabeçalho `X`:** inclui "Buscar cliente" + seletor de carteira antes das ações.
- **Suspeita** (sem login): Campanhas, Templates e Pessoas, que montam o próprio cabeçalho.

### 3. Sino, avatar, ⌘K e Assistente no trilho: confirmado que dá, com quatro cuidados
- **Sino** (`U()` no `assistente-gaveta`): o popover é `absolute right-0 top-11 w-[380px]`, ancorado para baixo e para a esquerda. No trilho (canto inferior esquerdo) abriria **fora da tela**. Precisa abrir à direita do trilho e para cima, em portal.
- **Avatar** (`X()`): mesmo caso (`absolute right-0 top-10 w-[240px]`).
- **⌘K:** a paleta é modal (fixed) e serve em qualquer lugar. Mas o **atalho de teclado ⌘K** e o comportamento no Início (`motorcob:focus-busca`) estão dentro do componente da barra do topo (`Z`). Ao remover a barra, mover esse `keydown` junto, senão o ⌘K para de funcionar.
- **Contador do Suporte** (`chamados` com `aguardando_cliente`, a cada 60 s, mais o evento `mc:suporte-visto`): também mora na barra. Mover o efeito para o item Suporte do trilho.
- **Botão do Assistente:** é um componente separado (`fixed right-5 z-40`, com o desvio automático de outros `fixed`). Não precisa mudar.

### 4. `areaDaRota` trata /empresa e /suporte? Confirmado: não como áreas próprias
- `area-rota-*.js` devolve `workspace` para `/inicio`, `/empresa*`, `/conta*`, `/suporte*`, `/docs*`, `/documentacao` e `/assistente*`. Para o trilho marcar Empresa e Suporte, é preciso acrescentar `empresa` e `suporte` (e decidir `/conta`, `/docs`).
- O **padrão** da função é `cobranca`: qualquer rota não listada (inclusive a 404 e `/cliente`) vira Cobrança e dispara `aplicarFrente('motorcob')`.
- `/console/produtos`, `/console/fornecedores`, `/console/qualidade` e `/console/filtro-inteligencia` devolvem **`mensageria`**: no trilho essas telas do Console marcariam Mensageria.

### 5. Contadores das abas: confirmado que só um existe pronto
| Contador | Origem hoje |
|---|---|
| Suporte "Aguardando você" | **Existe:** barra do topo, `from('chamados').eq('situacao','aguardando_cliente')`, contagem a cada 60 s. |
| "Respostas sem dono" | **Não existe.** O que o `app-shell` calcula é a **soma de `nao_lidas`** de `mensageria_conversas` (SMS/RCS/WhatsApp), e só quando a rota é `/mensageria*`. "Sem dono" seria `responsavel is null` (como no `para_hoje` do SQL 45): consulta nova. |
| Lista do dia | **Não existe** na moldura. Consulta nova (`fila_dia`, `count` por empresa, carteira e data). |
| Faturas em aberto | **Não existe** na moldura. O `app-shell` só lê `acesso_da_empresa` e `acordos`. Consulta nova (`faturas` com situação em aberto) e só para quem tem `ver_faturamento`. |

### 6. Elementos fixos que dependem do aside: confirmado, nenhum por posição
- Nenhum `lg:pl-[…]`/`lg:ml-[…]`/`left-[232px]` no bundle. O conteúdo é irmão do aside num `lg:flex`.
- O "Salvar" da Orquestração e o botão do Assistente são `fixed` à direita: não dependem do aside.
- **Risco real é outro (confirmado):** "o cartão rola por dentro" (§1.4) troca a rolagem da janela pela de uma `div`.
  - O React Router usa `window.scrollY`/`window.scrollTo` para voltar ao topo e restaurar a posição (`lib-*.js`, ScrollRestoration). Com rolagem interna, **cada navegação abre na posição de rolagem da tela anterior** e o "voltar" não restaura.
  - O `info-button` escuta `scroll` na janela.
  - Os `sticky top-0` da Orquestração, Canais e Momentos passam a grudar no topo do cartão (ok).
- Recomendo **rolar a página (window)** com o trilho `sticky`/`fixed`, e não o cartão.

### 7. Ícones lucide no bundle: confirmado
- Já existem: Wallet, Route, Compass, MessageSquare, ChartColumn, Building2, LifeBuoy, Shield, ShieldCheck, Bell, Terminal, Menu, Search, User, LogOut, Radar, Inbox, Users/UsersRound, Settings/Settings2, LayoutDashboard, LayoutGrid, Megaphone, Map, Layers, List, FileUp, ScrollText, Gauge, Landmark, TrendingUp…
- **Não existe `Home`/`House`** (o `home-*.js` é a tela Início, não o ícone).
- O Horizons recompila, então importar não é problema.

### 8. `--base-app` conflita? Confirmado: não existe, mas já há um equivalente
- `--base-conteudo` (#f8f8f9 claro / #000 escuro) já é o fundo da página (`.mc-platform{background-color:var(--base-conteudo)}`). Criar `--base-app` duplica. Melhor: `--base-app: var(--base-conteudo)` ou usar a variável que já existe.
- **Conflito confirmado:** a raiz das molduras tem a cor na própria classe.
  - `app-shell`: `mc-platform … bg-[#FFFFFF]`.
  - `workspace-shell`: `mc-platform … bg-[#F5F5F7]`.
  - A regra `.mc-platform .bg-[#FFFFFF]` é de descendente e não pega o próprio elemento. Essas classes da raiz precisam sair, senão o fundo fica branco/cinza fixo por cima de `--base-app`.
- **Precisa de login:** o `tema-provider` injeta em `:root` as variáveis da tabela de paleta do banco. Se lá existir uma chave `destaque` ou `base.app`, ela sobrescreve o CSS do §4.

### 9. Listas que já paginam: confirmado
- **Paginam de verdade:** só **Clientes** (`count: 'exact'` + `.range`) e **Auditoria** (`.range` + `count`).
- Ações e reenquadramento usam `.range` para **buscar tudo em lotes de 1000**: não é paginação de tela.
- **Trazem tudo de uma vez** (sem `range`/`limit`): Personas, Campanhas, Templates, Listas, Lotes (`lotes-lista` e `mensageria-lotes`), Segmentos, Carteiras, Pessoas e Suporte.
- **Relatórios** usa `.limit(50)`.

## Revisão do PROMPT_75 v2

### Contradiz o código
1. **§3 Relatórios "Meus arquivos (?exportacao=)":** a tela só abre a lista se o parâmetro tiver valor (`n.get('exportacao') && B(!0)`); vazio não abre. Usar `?exportacao=1`.
2. **§3 Suporte "Abertos · Resolvidos":** `/suporte` não lê parâmetro nenhum. A aba exige mudar o conteúdo da tela (filtrar), o que o próprio prompt proíbe ("não mude… o conteúdo"). Sem isso, as duas abas mostram a mesma lista. Ou tirar as abas do Suporte, ou permitir explicitamente `?situacao=` com o filtro.
3. **§3 contadores:** "Respostas sem dono" não é o número que existe (é soma de não lidas). Lista do dia e Faturas exigem consulta nova (pergunta 5). Dizer qual consulta, com qual permissão, ou ficar só com o contador do Suporte.
4. **§1.3 e §1.2 "areaDaRota":** sem acrescentar `empresa`/`suporte` e sem trocar o padrão `cobranca`, o trilho não marca Empresa nem Suporte. Rotas desconhecidas e a 404 marcam Cobrança e trocam a frente; as telas de Mensageria do Console marcam Mensageria (pergunta 4).
5. **§2 "todas as telas passam a usar X":** o `X` do `app-shell` traz embutido o `Y()` ("Buscar cliente" + carteira). O Workspace usa outro cabeçalho (`T` do `workspace-shell`), e Jornada, Mensageria, Empresa e Console têm cabeçalhos próprios (pergunta 1). O prompt precisa dizer, moldura por moldura, qual cabeçalho sai e o que fica:
   - **Jornada:** fica o seletor de Carteira.
   - **Mensageria:** fica a pílula Simulação/Envio real e a faixa "Pedir envio real"; sai "Trocar de canal".
   - **Empresa:** fica o "Mais ações" e as ações da equipe.
   - **Console:** a função e o "Só a carteira" vão para o subtítulo.
6. **§4 `--base-app`:** já existe `--base-conteudo` com o mesmo papel. Tirar `bg-[#FFFFFF]` e `bg-[#F5F5F7]` da raiz das molduras.
7. **§4 "Os botões principais em #0F4C5C ou #1D1D1F passam a --destaque":** `bg-[#1D1D1F]` aparece 182 vezes e não é só botão (dicas do menu recolhido, pílulas ativas, kbd, chips, avatar). Uma troca por CSS pinta tudo de ouro; uma troca tela a tela é do tamanho do 77. Limitar o 75 ao botão do cabeçalho `X` e às abas; o resto vai para o 77.

### Quebra o que funciona
1. **Console sem navegação (Alta, equipe):** o menu do Console está no aside que o §1.1 manda remover, e o §3 não define abas para o Console. Incluir: "Console: Clientes (Empresas, Saúde, Implantação, Carteiras) · Suporte (Atendimento, Assistente) · Financeiro (Faturamento, Margem) · Mensageria (Produtos e preços, Fornecedores e rotas, Qualidade, Filtro) · Administração (Equipe, Auditoria) · Sistema (E-mails)", com os contadores de Atendimento e Implantação que o `app-shell` já calcula.
2. **Rolagem dentro do cartão (§1.4):** quebra a volta ao topo e a restauração de rolagem do React Router (pergunta 6). Rolar a janela e deixar o trilho fixo.
3. **⌘K e contador do Suporte:** somem com a barra do topo se o prompt não mandar mover o `keydown` e o efeito de contagem (pergunta 3).
4. **Popovers do sino e do avatar:** abrem fora da tela no trilho (pergunta 3). Mandar abrir à direita e para cima, em portal z-[70].
5. **Empresa › Visão geral (`/empresa`, a Ficha):** não está nas abas do §3. Hoje é a 1ª aba do `empresa-shell`. Acrescentar "Visão geral".
6. **Relatórios em §3:** a lista começa em Cobrança, mas `orquestracao` está ativo para toda empresa (rodada anterior). "Só as liberadas" tem que usar as frentes do `use-areas-liberadas`, não `empresa_modulos`.

### O que o Horizons provavelmente ignora ou aplica pela metade
- **§2 e §3 dependem de mexer em ~35 telas** (cabeçalho em cada uma) e em seis molduras. No 73 e no 74 ele aplicou a moldura e deixou as telas; aqui o resultado provável é trilho novo com cabeçalhos antigos e abas duplicadas com as do `empresa-shell` e do `mensageria-canal-layout`.
- **§3 lista ~45 rotas** em texto corrido. Mandar como **tabela de mapeamento** (rota → área → aba → subaba), que dá para colar como constante (`ABAS_POR_AREA`).
- **§4 e §6 são CSS:** o 74 aplicou o CSS pela metade e em minúsculas. Manter o bloco pronto para colar (o §6 está certo) e pôr o §4 no mesmo bloco.
- **§5 tem cinco assuntos** (frente, empresa, carteira, marca, CSS) num parágrafo de "mantenha". Viram itens soltos e alguns caem.

### Tamanho: grande demais para um prompt só
São 94 linhas que trocam a moldura inteira, o cabeçalho de todas as telas, a cor, a marca, o tema escuro e o cartão de carteira. Se o Horizons aplicar metade, o site fica sem menu lateral e sem abas, ou seja, sem navegação.

**Proposta de divisão (cada parte deixa o site usável sozinha):**

**75a — Demo de venda, sem mexer na moldura** (vale com o menu lateral de hoje):
- Marca: helper `seo` + textos visíveis + `frentes.nome` → nome da área + logo do login "MotorCX" (aceite: nenhum MotorCob no view-source de `/login` e `/fila`).
- CSS do tema escuro (§6, bloco pronto) + tokens `--destaque` (§4, só as variáveis).
- "Escolha a carteira" com botões (Lista do dia, Orquestração, Personas e Comitê); "credor" → "carteira" com as exceções.
- `mc-empresa` não apagada no logout.
- O botão principal do `X` em `--destaque` (só esse componente).

**75b — Moldura nova** (depois do 75a):
- §1 trilho + faixa de contexto + gaveta, com a **rolagem na janela**.
- `areaDaRota` com `empresa`/`suporte` e sem padrão `cobranca`.
- Mover o ⌘K, o contador do Suporte, o sino e o avatar, com popovers em portal.
- §3 abas por área **incluindo o Console** e a Empresa › Visão geral, como tabela de rotas. Sem abas no Suporte, ou com o filtro permitido.
- Contadores: só o do Suporte (e o de Atendimento/Implantação no Console). O resto no 77.
- Cabeçalhos: só remover os duplicados das seis molduras (Jornada, Mensageria, Empresa, Console) e manter os controles que eles têm.
- Aceite: toda rota do menu antigo, **inclusive as 15 do Console**, abre com uma aba marcada.

**Para o 77:**
- Cabeçalho `X` em todas as telas com `h1` próprio.
- "Buscar cliente" → ⌘K.
- Uma ação principal por tela.
- Recolorir os botões `#0F4C5C`/`#1D1D1F`.
- Contadores Lista do dia e Faturas.
- Paginação.
