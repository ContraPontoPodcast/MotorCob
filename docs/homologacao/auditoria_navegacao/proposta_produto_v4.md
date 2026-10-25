# MotorCX: nova linguagem do produto (trilho, cabeçalho e abas)

25/10/2026 · UX designer · Referência visual do dono: `images/36.webp`. É de outro produto: usei só o padrão, nenhum
número, nome, ID ou URL dela.

Entregas (`.../scratchpad/ux/`):
- `produto-prototipo.html`: Início, Cobrança › Lista do dia (com "Escolha a carteira"), Estratégia › Personas (grade e lista + paginação), Mensageria › Campanhas, Relatórios; claro e escuro; celular.
- O 75 foi dividido, depois da revisão do CX (`cx/respostas_ux_75v4.md`):
  - `PROMPT_75A_DEMO_MARCA_TEMA.md` (67 linhas): marca, tema escuro, carteira e `mc-empresa`, sem mexer na moldura;
  - `PROMPT_75B_TRILHO_E_ABAS.md` (93 linhas): moldura nova, com a tabela rota → área → aba, inclusive o Console;
  - `PROMPT_77_PADRAO_DE_LISTAS.md`: escopo do padrão de listas, como lista de itens.
- **Valem mais que o resto deste texto onde divergem:** a página rola (não o cartão); o ouro fica só no botão principal e nas abas; o Suporte não tem abas; a Empresa abre em Visão geral.
- Este documento.

## 1. Arquitetura

**Moldura.** Fundo cinza-claro (`--base-app`) com dois cartões:
- à esquerda, o **trilho** de 64 px;
- à direita, o **cartão de conteúdo**, que rola por dentro.

**Trilho** (de cima para baixo):
- símbolo MotorCX (leva ao Início);
- Início;
- Cobrança, Jornada do Cliente, Mensageria e Relatórios;
- espaço;
- Empresa, Suporte (com o contador "Aguardando você"), sino, Console (só equipe) e o avatar quadrado na cor de destaque.

Regras do trilho:
- Item ativo: fundo claro e marcador ouro à esquerda.
- Área não contratada: esmaecida, com a dica "Não contratada". O clique abre "não faz parte do plano".
- Acrescentei **Empresa** ao trilho (não estava na lista do orquestrador). Sem o Empresa ▾ do topo, as telas de Admin (Pessoas, Integrações, Faturas, Auditoria) precisam de uma porta, e com as abas elas viram uma "área" como as outras.

**Empresa (contexto) fica no topo do cartão**, numa faixa fina de 44 px:
- à esquerda, a empresa. Equipe: pílula com troca (é a pílula `q` que já existe). Cliente: só o nome, em cinza.
- à direita, a busca ⌘K e o "?".

Por que no cartão e não no trilho: o nome não cabe em 64 px, e no topo do cartão ele enquadra tudo o que está
abaixo, como um "você está vendo a empresa X".

**Cabeçalho de página** (padrão da referência):
- rótulo em caixa alta (área, ou "área · aba");
- título;
- subtítulo de uma linha;
- **uma** ação principal em ouro.

Seletores de contexto (Carteira) ficam ao lado, em contorno. "Buscar cliente" sai do cabeçalho e vai para o ⌘K.

**Seções = abas** (ícone + nome + contador); subseções = subabas em pílula. As rotas não mudam.

| Área | Abas (subabas) |
|---|---|
| Cobrança | Lista do dia · Clientes · Ações · Cargas · Estratégia (Orquestração, Personas, Segmentos, Carteiras, Canais e frases, Mapa da Esteira, Comitê) · Resultados (Painel, Relatórios ↗) |
| Jornada do Cliente | Visão geral · Lista do dia · Cargas · Estratégia (Momentos e fases, Mensagens por momento, Carteiras) |
| Mensageria | Campanhas · Lotes · Respostas (Caixa, Radar) · Templates · Listas · Resultados (Painel do canal, Score de Entrega, Relatórios ↗) · Configurações (Do canal, Atendimento). O canal vira pílulas "CANAL SMS \| RCS" abaixo das abas |
| Relatórios | Cobrança · Jornada · Mensageria · Meus arquivos |
| Empresa | Dados e contatos · Pessoas e perfis · Integrações · Faturas · Contratação (equipe) · Auditoria |
| Suporte | Abertos · Resolvidos |

Escolhi **subabas em pílula, não um seletor dentro da aba**. Com sete telas em Estratégia, um seletor esconde as
opções. As pílulas mostram todas e rolam no celular.

**Cor de destaque: ouro MotorCX, uma só.**
- Claro: `#8A6A2E` (contraste ≈ 5:1 com texto branco).
- Escuro: `#D9B26B` com texto `#1D1D1F` (≈ 8:1 sobre o cartão escuro).
- Suave: `#F4EDE0` / `#3A2F1C`.

É o ouro do símbolo da marca (`#C9A35A`), escurecido para passar contraste. Ele pinta a ação principal, a aba
ativa, o marcador do trilho, o avatar e a página ativa. As cores por área saem da moldura; os estados (verde,
âmbar, vermelho) continuam só para status.

**Celular (< 1024 px):**
- o trilho vira uma barra no topo do cartão: ☰, MotorCX, sino e avatar;
- o ☰ abre uma gaveta com os mesmos itens e os nomes;
- abas e subabas rolam na horizontal;
- a grade vira uma coluna.

Escolhi ☰ e não barra inferior porque são até nove destinos (seis no trilho + Empresa, Suporte e Console). Numa
barra de baixo não cabem sem um "Mais".

## 2. O que vai em cada prompt
- **75 (escrito):**
  - trilho, cartão e faixa de contexto;
  - cabeçalho de página com uma ação;
  - abas e subabas por área, com as rotas de hoje;
  - destaque único;
  - celular;
  - o que foi acertado com o CX: `aplicarFrente`, `mc-empresa`, "Escolha a carteira", MotorCX, CSS do tema escuro, portal `z-[70]`, nada de ids ou parâmetros.
- **76 (escrito):** site público e autenticador. Não muda.
- **77 — padrão de página e listas (a escrever):**
  - barra da seção (rótulo em caixa alta + contagem; à direita, busca em ícone e alternância grade/lista, lembrada por tela no localStorage);
  - cartão de grade: avatar ou ícone, pílula com o dado principal e o botão copiar, ações em ícone (etiqueta, desempenho, ›), status em pílula e selo à direita, divisória, metadados em duas colunas;
  - rodapé fixo de paginação: "Itens por página [12 ▾]", "1–12 de N resultados", "Página x de y" e botões numerados;
  - aplicação em Personas, Segmentos, Carteiras, Campanhas, Templates, Listas, Lotes, Pessoas e Relatórios salvos;
  - mais: estados vazios padrão (ícone, frase e próximo passo), esqueleto de carregamento, confirmação do prompt 49 no lugar dos 16 `confirm()`, títulos num tamanho só.

  Fica fora do 75 porque toca em cada tela de lista (consultas com paginação: `range`/`count`), e o 75 já está em 94 linhas.
- **78 a 80:** vocabulário, celular/densidade e Console, como na auditoria.

## 3. O que o CX precisa conferir no bundle (`/tmp/claude-0/site4/js`) antes do 75
1. **Quem desenha a moldura hoje:** `app-shell` (áreas), `workspace-shell` (Início, Empresa, Suporte, Conta; 6 módulos o importam), `console-shell`, `jornada-shell` (7 módulos) e `mensageria-canal-layout`. Algum deles tem cabeçalho ou abas próprias que vão duplicar com as do 75? (O `empresa-shell` tem abas; a Mensageria tem "Escolha o canal".)
2. **O componente de cabeçalho `X` (`a as X` do `app-shell`):** quantas telas o usam (27 módulos importam o `app-shell`) e quantas desenham o próprio `h1` (14 com `text-[28px] font-bold` ou `mc-page-title`). Quais têm mais de uma ação principal no cabeçalho?
3. **Onde ficam o sino, o avatar, o ⌘K e o botão flutuante do Assistente** (`assistente-gaveta`: `X`, `q`, `Z`). Dá para levá-los ao trilho sem perder o popover de avisos e o contador do Suporte?
4. **`areaDaRota` do 73/74 (`area-rota-*`):** cobre `/empresa/*` e `/suporte/*` como áreas, para o trilho marcar Empresa e Suporte?
5. **Contadores das abas:** de onde vem cada número sem consulta nova? Lista do dia (`fila_dia`), Respostas sem dono (o contador que o `app-shell` já põe no item Respostas), Faturas em aberto (`para_hoje`/`faturas`), Suporte (o número do topo).
6. **Telas que dependem de `aside` ou de `lg:pl-[…]` para a margem do conteúdo:** ao tirar o menu lateral, nada fica deslocado (por exemplo o botão fixo "Salvar" da Orquestração, `fixed bottom-6 right-6`).
7. **Ícones lucide:** Home, LifeBuoy, Shield e Route existem no bundle ou precisam de import? (Wallet, MessageSquare, ChartColumn e Building2 já estão, segundo o CX.)
8. **Tema escuro:** `--base-app` não existe hoje; há algum fundo de página (`bg-[#FFFFFF]` no `mc-platform`) que vai brigar com ele?
9. **Paginação (para o 77):** quais listas já paginam no banco (`range`) e quais trazem tudo de uma vez (Personas, Campanhas, Templates)?
