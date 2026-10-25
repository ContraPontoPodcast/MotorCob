# CX → UX: conferência da auditoria completa e do PROMPT_75

25/10/2026 · Fontes:
- Bundle atual: `/tmp/claude-0/site4/js` (cópia legível `scratchpad/ux/pretty4/`) e `site4/all.css`.
- `curl` no site no ar.
- O MCP do Supabase respondeu "Unauthorized" (sem token de acesso), então nada foi lido do banco.

Legenda: **confirmado** · **suspeita** · **precisa de login** (ou de acesso ao banco).

## Respostas às 10 perguntas

**1. "MotorCob" na pílula: confirmado que é dado; qual empresa, só com login.**
- A pílula do menu (`app-shell`, `Ae()`) e a do topo (`assistente-gaveta`, `q()`) mostram `empresa.nome`, que vem de `from('empresas').select('id,slug,nome,ativa')` no `auth-provider`.
- Não é texto do site. Qual linha de `empresas` se chama "MotorCob" só dá para ver no Console ou no banco.
- Atenção: "MotorCob" também aparece como **texto do site** por outro caminho, o nome da frente (`frentes-*.js`: `motorcob: { nome: 'MotorCob' }`, `motorcli: { nome: 'MotorCli' }`). Ele aparece em quatro lugares:
  - nos cartões de escolha do login (`login`: `children: t.nome`);
  - no logo do login quando se chega por link com frente: "MotorCob por MotorCX" (`marca-motorcx`);
  - na pílula do Início: "MotorCob · Cobrança" (`home`: `r.nome, ' · ', r.area`);
  - no aviso do Workspace "Sua empresa ainda não tem o MotorCob" (`workspace-shell`: `l(e).nome`).
- O prompt 75 não trata isso (ver A4).

**2. Classes do tema escuro: confirmado.**
- O bloco `[data-tema=escuro] .mc-platform …` do `all.css` está quase todo em minúsculas (`bg-\[\#f5f5f7\]`, `bg-\[\#f2f2f7\]`, `bg-\[\#fffbf0\]`…). O bundle usa maiúsculas:

  | Classe | Usos no bundle (maiúsc.) | Regra no bloco escuro (maiúsc.) |
  |---|---|---|
  | `#F5F5F7` | 499 | 0 |
  | `#FFE8E6` | 83 | 0 |
  | `#E8F8EC` | 37 | 0 |
  | `#FFF3E8` | 22 | 0 |
  | `#0A60D0` | 75 | 0 |

  Como o seletor CSS diferencia maiúsculas, essas regras não pegam.
- O que **funciona** hoje é outro padrão, sem depender do tema: `.mc-platform .bg-\[\#F5F5F7\]{background-color:var(--base-fill)}` (e o `hover:`). A cor vem de variável, e o `tema-provider` redefine as variáveis em `:root{}` e `[data-tema="escuro"]{}`, montadas a partir da tabela de paleta (`chave`, `claro`, `escuro`) na `<style id="mc-tema-dinamico">`.
- O `tema-provider` **não** mapeia classes, só variáveis. O melhor lugar é o mesmo padrão: uma regra `.mc-platform .<classe exata>` → `var(--…)`, com a variável clara e escura definida uma vez.

**3. "Todas as carteiras": confirmado.**
- Exigem uma carteira ("Escolha o credor no topo…"): `fila`, `orquestracao`, `personas` (página e "copiar modelos"), `comite` e `envios`.
  - No `envios` o texto é outro: "Escolha o credor no topo **do bloco de envio**". É validação do formulário, só para tipos com `credorRequired`, não um bloqueio da página.
  - Na `fila`, o aviso só aparece com mais de uma carteira (`pe = !t && n.length > 1`). Com uma só, ela já vem escolhida (`auth-provider`: `!c && n.length === 1 && (c = n[0])`).
- Aceitam todas: `painel` e `acoes` (`t && q.eq('credor_id', …)`).
- **Suspeita:** `clientes`, `mapa` e `canais` filtram por `credor_id` em algumas consultas sem aviso; com "Todas" podem vir vazias ou parciais. Precisa de login.
- `selectCredor` (`auth-provider`, função `V`) grava em localStorage com a chave `motorcob.credor.{empresa_id}` e na URL `?credor={codigo}`. Ela tem prioridade sobre o localStorage ao carregar.

**4. Ícones lucide: confirmado.**
- No `app-shell`, `v` = **Wallet**, `y` = **Compass**, `_` = **ChartColumn** (todos vêm de `workspace-command-palette`: `d`, `l`, `c`), `w` = **MessageSquare**, `T` = **Route**, `g` = **Building2**.
- Hoje a Jornada usa **Compass**, não Route. `BarChart3` é o nome antigo de `ChartColumn` no lucide (o bundle já usa `ChartColumn`).
- O Horizons recompila, então qualquer ícone lucide funciona. Não há restrição de "já importado".

**5. Menu suspenso saindo do aside recolhido: confirmado no código, conferir na tela.**
- `aside.mc-menu` não tem `overflow-hidden`. Só o `<nav>` tem `flex-1 overflow-y-auto`, e o cabeçalho do menu, onde fica o seletor, está **fora** do `nav`. Um popover absoluto no cabeçalho não é cortado.
- Risco: o `aside` é `z-40` e o topo (`header sticky top-0 z-40`) vem depois no DOM. Com z-index empatado, o topo cobre o que passar por cima dele. Um menu que abre à direita, na altura do topo, fica embaixo da barra.
- Usar portal (`createPortal` no `body`) ou `z-[70]`.

**6. Última empresa da equipe: confirmado.**
- A chave já existe: `localStorage['mc-empresa']` (`auth-provider`, `h = 'mc-empresa'`).
  - É gravada em `selectEmpresa` (função `B`).
  - É lida no login da equipe (`String(e.id) === n`); com uma empresa só, ela é escolhida sozinha.
  - **É apagada ao sair** (função `z`, `!e` → `localStorage.removeItem(h)`).
- Por isso "não lembra": dura enquanto a sessão dura e some no logout. Não precisa de chave nova; basta não apagar `mc-empresa` no logout (ou pôr o id do usuário na mesma chave).

**7. "Responsável pela venda" e "Gerente da conta": confirmado que o cliente vê.**
- `empresa-DMUOG2it.js`, cartão "Ficha da empresa": `v({label:'Responsável pela venda', value:u})` e `v({label:'Gerente da conta', value:p})` sem nenhuma condição de equipe. O formulário de edição também tem os dois campos (l.361, l.385).
- O que aparece no valor (nome de alguém da equipe ou "—") depende do dado. Precisa de login.

**8. `confirm()` nativos: confirmado, 13 módulos e 16 chamadas.**
- `canais` "Excluir o modelo de mensagem…?"
- `console-assistente` "Excluir esta resposta?"
- `console-faturamento` "Confirmar o pagamento recebido por fora do Stripe…"
- `conta` "Desligar a verificação em duas etapas?"
- `credor-configuracoes` "Aceitar a sugestão do MotorCob para os N status/resultados novos?" (2)
- `credores` "Selecionar … agora e abrir as configurações?"
- `empresa-contatos` "Excluir o contato …?"
- `jornada-mensagens` "Excluir a mensagem …?"
- `mensageria-listas` "Remover este contato da lista?"
- `mensageria-templates` "Arquivar template?"
- `orquestracao` "Tirar … de todos os dias desta faixa?" e "Remover a coluna …?"
- `personas` "Apagar a persona …?"
- `relatorios` "Parar o envio por e-mail…?" e "Apagar este relatório?…"

`confirma-acao` aceita `{aberto, titulo, texto, botao, onConfirm, onClose, corBotao, loading}`: tem `texto` para a consequência e `corBotao` para destrutivo. Serve. (Isto é do prompt 77, não do 75.)

**9. "| MotorCob" nas abas: confirmado.**
- Vem do `meta` de cada rota. O helper `seo-*.js` só repassa `i.title`. São **60 títulos** escritos à mão "… | MotorCob" em 60 módulos.
- O `root` já tem um corretor no navegador (função `k`, um `MutationObserver` no `<title>`) que troca `"X | MotorCob"` por `"X · MotorCX"` depois que a página carrega. **No navegador, a aba já mostra "· MotorCX".**
- O que continua "MotorCob" é o HTML que o servidor manda: `curl /login` → `<title>Entrar | MotorCob</title>`; `/fila` → "Lista do dia | MotorCob"; `/privacidade` → "Privacidade | MotorCob". Isso vale também para `og:title`, `twitter:title` e a `description`, que é o que aparece ao colar o link no WhatsApp ou e-mail e na busca do Google, além da aba no primeiro instante.
- Corrigir de vez exige trocar o `title` e a `description` nos 60 `meta`. Um helper não resolve sozinho, porque o texto está em cada rota. Dá para pôr a troca no próprio `seo-*.js` (função `n`: substituir `MotorCob` no `title` e na `description` antes de montar as tags), o que pega tudo de uma vez inclusive no servidor.

**10. `site-*.js`: confirmado.**
- É a rota `routes/site` (index `/`) de motorcob.online, a página que o prospect vê.
- O título já é "MotorCX · Pare de adivinhar.", mas o texto visível tem **9 "MotorCob"** (logo no topo, "O MotorCob usa seus agentes…", "Apresentamos MotorCob", "Suporte MotorCob", "Concordo que o MotorCob use estes dados…", "© 2026 MotorCob") e só 1 "MotorCX".
- Fora do Horizons:
  - **motorcli.online** está no ar ("MotorCli · Jornada do Cliente, uma frente do MotorCX"). É outra página de vendas, com a marca MotorCli.
  - **motorcx.online** e www estão "Parked Domain" na Hostinger.
  - O site v7 que está no repositório não está publicado.

## Correções à auditoria (para não ir errado ao dono)
- **UX-02:** as abas no navegador já dizem "· MotorCX" (corretor do `root`). O que está errado é o título do servidor, o `og:title`/`description` (prévia de link e Google) e os textos visíveis. A severidade continua, porque a prévia de link numa demo mostra MotorCob.
- **UX-16:** a lista do Suporte **já tem cartões** no celular (`suporte-BfhwTzre.js`: `mc-tabela-container`, `mc-tabela-desktop`, `mc-tabela-cards`). Conferir na tela antes de mandar para o 79.
- **UX-01:** a linha de áreas do 74 **foi aplicada** (`Me()` com `aplicarFrente`). O problema é visual, não ausência.
- **UX-11:** a equipe já tem pílula no topo (`assistente-gaveta`, `w && q()`) **e** no menu (`Ae()`). São duas pílulas hoje.

## Revisão do PROMPT_75

### Contradiz o código ou quebra o que funciona
| # | Trecho | Problema | Ajuste |
|---|---|---|---|
| A1 | §2 "guarde a última empresa em localStorage (chave mc-empresa-equipe:{id})" | Já existe `mc-empresa`. Uma 2ª chave cria duas fontes de verdade, e o `auth-provider` continua lendo só a antiga. O motivo de "não lembrar" é o `removeItem` no logout. | "Use a chave existente `mc-empresa`; não a apague ao sair (ou grave `mc-empresa:{id do usuário}` no lugar dela, lendo e gravando no mesmo ponto do `auth-provider`)". |
| A2 | §2 "a pílula de empresa … fica SÓ na barra do topo" com estilo novo | A pílula do topo já existe (`q()` no `assistente-gaveta`). Sem dizer isso, o Horizons tende a criar uma terceira. | "Remova `Ae()` do menu lateral e restile a pílula que já está no topo (`q`)". |
| A3 | §1 Gaveta: "Empresa (Dados e contatos, Pessoas e perfis, Faturas)" | Hoje a gaveta e o Empresa ▾ têm também **Integrações** e **Auditoria** (com `ver_auditoria`). Tirar esses dois quebra o caminho, no celular, para integrações/API e auditoria. | Manter os 5 itens, com as permissões de hoje. |
| A4 | §4 Login: só troca duas frases | O login continua mostrando **"MotorCob"/"MotorCli"** nos cartões de escolha (`t.nome`) e no logo "MotorCob por MotorCX". O Início mostra "MotorCob · Cobrança", e o Workspace "Sua empresa ainda não tem o MotorCob". Tudo vem de `frentes.nome`. | Mostrar `area` ("Cobrança", "Jornada do Cliente") onde hoje aparece `nome`, nesses 4 lugares. Não mexer no id `motorcob`/`motorcli`. Decidir com o dono se o logo "MotorCli por MotorCX", para quem vem de motorcli.online, fica (é uma marca de venda ativa). |
| A5 | §4 Título da aba | Na aba já está certo no navegador. O que falta é o servidor e a prévia de link. Listar 60 rotas é o tipo de instrução que o Horizons aplica pela metade. | "No helper `seo` (o que monta title/og/twitter/description), troque 'MotorCob' por 'MotorCX' e ' \| ' por ' · ' no fim do título; depois troque também o texto nos `meta` das rotas". O corretor do `root` fica como rede de segurança. |
| A6 | §4 lista de textos | A lista deixa de fora textos visíveis que existem: "O Suporte da MotorCob responde em até 1 hora" (`mensageria-canal-layout`), "Equipe MotorCob no Console" (`console-equipe`), "Aceitar a sugestão do MotorCob…" (`confirm` em `credor-configuracoes`), "fale com o suporte MotorCob" (`DuasEtapas`), as descrições "Acesse a plataforma MotorCob…" do login e ~100 trechos distintos no total. | Trocar a lista por uma regra: "Todo texto visível 'MotorCob' vira 'MotorCX' (e 'MotorCli' vira 'Jornada do Cliente'), exceto: ids internos, `empresas.nome` (dado), o nome do fator do autenticador (`duasEtapasLogica`: fica para o 76) e o site público (76)". Conferir com `grep MotorCob` = 0 fora dessas exceções. |
| A7 | §3 "Em todos os textos visíveis, 'credor(es)' vira 'carteira(s)'" | Na documentação da API, `credor` é **nome de parâmetro** (`?credor=banco-x`, escopo "credor fora do token"). Trocar ali quebra a doc da integração. O `?credor=` da URL do app também é código. | "Exceto `docs-api`, `/documentacao` e nomes de parâmetro/campo". |
| A8 | §3 Enviar arquivos no mesmo pacote | Em `envios` não há bloqueio de página: é a validação do formulário ("no topo do bloco de envio"), só para tipos que exigem carteira. Trocar por cartões de botões quebra o fluxo de envio. | Em Enviar arquivos, só trocar "credor" por "carteira" no texto. Os cartões "Escolha a carteira" valem para Lista do dia, Orquestração, Personas e Comitê. |
| A9 | §5 Tema escuro: regras novas dentro de `[data-tema=escuro] .mc-platform` | Repete o padrão que falhou no 74 (caixa) e precisa de valores para claro e escuro separados. O padrão que funciona no site é `.mc-platform .classe → var(--…)`. Faltam as variantes `hover:` e `border-` das mesmas cores. | "Faça como `.mc-platform .bg-[#F5F5F7]` (já existe): uma regra por classe exata, em maiúsculas como no código, apontando para variáveis novas (`--aviso-erro-fundo`, `--aviso-ok-fundo`, `--aviso-atencao-fundo`, `--link`), definidas no claro e no escuro". Incluir `hover:` e `border-`. Conferir: `grep -c` no CSS final das classes maiúsculas > 0. |
| A10 | §1 Cores e ícones das áreas | O CSS já tem `--area-cobranca #8a6a2e`, `--area-jornada #4f6b3a`, `--area-mensageria #7a2e3b`, `--area-neutro #1d1d1f`. O prompt usa #3A3A3C para Relatórios e valores escuros fixos, sem variável. A Jornada usa Compass hoje; o prompt diz Route. | Usar as variáveis `--area-*` e acrescentar as versões escuras **nelas**. Dizer explicitamente "Jornada: trocar Compass por Route" se essa for a intenção, e "BarChart3 = ChartColumn". |
| A11 | §1 Menu suspenso no recolhido "abre à direita" | Empate de z-index com o topo (pergunta 5). | "Renderize o menu num portal (body) com z-[70]". |

### O que o Horizons provavelmente não aplica (instruções longas ou implícitas)
- **§5 é uma lista de ~30 classes:** o Horizons tende a aplicar parte e em minúsculas (foi o que aconteceu no 74). Pôr como **bloco CSS pronto para colar** (as regras escritas), não como lista.
- **§4 depende de 60 arquivos:** sem o atalho do helper `seo` (A5), vai sobrar "| MotorCob" no servidor.
- **§1 traz "Tire … a linha de botões de área" e "o mesmo seletor na gaveta" no mesmo parágrafo:** no 73 a linha foi ignorada. Pôr como passos numerados com critério de aceite (ex.: "o `aside` não tem nenhum `button` com o nome de uma área fora do seletor").

### "Bloqueia vender" sem solução no 75
| Item | Situação |
|---|---|
| Marca no site público (`site-*`, 9 "MotorCob" visíveis) e na prévia de link (`og:title` do servidor) | Vai para o 76. É o 1º contato do prospect: o 76 precisa sair junto com o 75. |
| "MotorCob/MotorCli" no login (cartões e logo) | Não coberto (A4). É a 1ª tela de uma demo. |
| Empresa "MotorCob" na pílula (UX-05) | Dado: ação do dono no Console (renomear e criar a empresa de demonstração). Fora do prompt. |
| **Tokens de API (CX-05)** | Continua sem tela: nenhum módulo do bundle chama `criar_token_api`. Quem vende integração por API não consegue entregar. Precisa de prompt próprio (republicar o 63). |
| Painel/Clientes escondidos por `ver_painel`/`ver_clientes` fora do catálogo (N2 da rodada anterior) | Continua sem verificação. O bundle atual ainda exige essas permissões (`auth-provider`). Se o banco for igual ao repositório, a demo da Cobrança fica sem Painel e Clientes. Conferir logado antes da demo. |
