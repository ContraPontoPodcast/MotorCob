# Orquestração: auditoria e redesenho (raias primeiro)

26/10/2026 · UX designer · Entradas:
- print do dono `images/40.webp`;
- código publicado `/tmp/claude-0/site6/js` (cópia legível em `ux/pretty6/`: `orquestracao`, `estrategia-editor-core`, `abas-telas`);
- aprovação do bloco 3 (`docs/homologacao/APROVACOES.md`, 14/10/2026) e prompts 41, 60 e 78.

Entregas (`.../scratchpad/ux/`):
- `orquestracao-prototipo.html`: claro e escuro, 1440, 1024 e 390 px; troca de segmento, gaveta de detalhes e edição de célula.
- `PROMPT_79_ORQUESTRACAO.md` (71 linhas).
- Este documento.

## 1. Auditoria: o que está na frente das raias
Do topo do cartão até a 1ª raia, em 1440 px: mais de uma tela de rolagem.

| # | Bloco (print) | Código | Problema | Destino |
|---|---|---|---|---|
| 1 | 13 abas numa fileira | `abas-telas`, `Ve()` junta as abas de todos os grupos e ignora o `rotulo` | A Estratégia (8 telas) se mistura com a operação; o "Estratégia" do v5 virou 8 abas | Uma aba por grupo + subabas (passo 1 do 79) |
| 2 | Rótulo + título "Orquestração" grande | `N({eyebrow, title, description})` | Ocupa ~110 px e repete a migalha da faixa de contexto | Título de 20 px na linha 1 da barra |
| 3 | "MotorCob · Carteira principal · data" + "Desenhe o que mandar…" | subtítulo do `N` e `description` | Repete empresa e carteira, mostra a marca antiga (dado) e explica o óbvio | Sai |
| 4 | "Buscar cliente", seletor de carteira, "Reenquadrar agora", "Ver todas as carteiras" | `Y()` do cabeçalho + `actions` (`de` = botão de reenquadrar, `Ie(!0)` = matriz) | Quatro controles sem hierarquia, dois deles raros | Buscar → ⌘K; carteira → uma vez só; Reenquadrar e Todas as carteiras → "⋯" |
| 5 | Cartão CARTEIRA com pílulas | `kt.map(... onClick: () => o(e.id))`, onde `o` = `selectCredor` | A **mesma** escolha do seletor do cabeçalho: escolhida duas vezes | Um seletor "Carteira ▾" na barra |
| 6 | Caixa azul de explicação | `div` fixo com o texto "Cada cliente da carga cai num segmento…" | Texto de manual permanente em toda visita | Popover "?" ao lado do título |
| 7 | Cartão SEGMENTOS (pílulas + "Novo segmento") | `Dt.map` / `Ot` (Pausados) | Necessário, mas num cartão alto | Linha 2 da barra, em pílulas com o nº de clientes |
| 8 | Cartão do segmento (Quem entra, Carteiras que usam, Ligado em todas, Tirar da carteira, Editar) | bloco em ~l.10140–10380 | Configuração do segmento, rara, empurra a esteira para baixo | Gaveta "Detalhes do segmento" |
| 9 | Aviso de estratégia compartilhada | regra do bloco 3 | Necessário quando há; hoje um bloco alto | Faixa âmbar de uma linha |
| 10 | Barra das vistas + estado + Copiar + Mais + Salvar (sticky) | `section sticky top-0` (~l.10414) | É a barra certa (bloco 3), mas vem depois de tudo | Funde com a linha 1/2 da barra nova |
| 11 | Raias | `estrategia-editor-core` + editor da orquestração | São o trabalho da tela | Logo abaixo da barra, ocupando o resto |

Também visto:
- os botões da tela usam o azul-petróleo antigo (`#0F4C5C`); só o "Salvar" deve ficar em ouro;
- o editor tem uma faixa interna `sticky top-0`, que vai precisar de deslocamento quando houver a barra sticky.

## 2. Desenho novo

Ordem no cartão (1440 px), com a 1ª raia a ~270 px do topo do cartão, sem rolar:
1. **Faixa de contexto** (moldura aprovada): migalha "Cobrança › Estratégia › Orquestração", ⌘K, "?" e sino.
2. **Abas da Cobrança:** Lista do dia · Clientes · Ações · Cargas · **Estratégia** · Painel.
3. **Subabas da Estratégia:** Orquestração · Personas · Segmentos · Carteiras · Canais e frases · Mapa da Esteira · Comitê (· Estratégias, se ficar).
4. **Barra da Orquestração** (sticky, duas linhas):
   - Linha 1: título, "?", **Carteira ▾** (a única); à direita, estado e **Salvar** (ouro).
   - Linha 2: **segmentos em pílula** (nome + nº de clientes; bolinha âmbar = compartilhada), "Pausados ▾", "+ Novo", **Detalhes do segmento**; à direita, as vistas (Desenho da esteira · Etapas e fases · Travas · Visão geral) e "⋯".
5. **Aviso de estratégia compartilhada**, numa linha (só quando houver).
6. **Raias**, com a coluna de momento/persona fixa à esquerda e os dias fixos no topo.

**Gaveta "Detalhes do segmento"** (440 px à direita):
- nome e selo Própria/Compartilhada;
- Quem entra + Editar condições;
- Carteiras que usam (caixas + chave Em uso);
- Ligado em todas;
- Clientes hoje;
- no rodapé, "Tirar da carteira" em vermelho.

**Menu "⋯":** Copiar de outra carteira · Começar do padrão MotorCX · Montar esteira pelas personas · Ver segmentos em
todas as carteiras · Reenquadrar agora · Imprimir / PDF. São as mesmas funções do "Mais" e dos botões de hoje.

**Edição da célula (protótipo):**
- popover junto da célula com os canais (na ordem), a frase (lista do padrão) e a prévia;
- "Sem ação neste dia", "Copiar para os outros dias" e, na raia de persona, "Voltar a seguir o geral".

É o mesmo conjunto do "Opções da célula" de hoje: o 79 não mexe no editor por dentro.

**Celular:**
- as duas linhas quebram e as vistas viram select;
- as pílulas rolam;
- a grade rola para o lado com a 1ª coluna fixa;
- a gaveta ocupa a tela.

**Regras do bloco 3 preservadas:**
- carteira no topo (agora na barra);
- aviso de compartilhada com "Separar só para esta carteira" / "Editar para as duas";
- "Copiar de outra carteira" sempre cria cópia independente (no "⋯", mesma janela);
- barra única com vistas + estado + Copiar + Mais + Salvar (agora numa barra de duas linhas);
- travas, fases e Visão geral sem mudança.

**Reduzir as 13 abas** (passo 1 do 79):
- O componente de abas passa a respeitar os grupos que já existem na configuração (`rotulo: "Estratégia"`, `"Resultados"`): uma aba por grupo e subabas em pílula quando o grupo está ativo.
- Depois do 78, que tira "Relatórios" das abas, o grupo Resultados fica só com "Painel" e aparece direto como aba.
- Resultado: 6 abas na Cobrança.
- Vale também para o Console (6 grupos).
- "Estratégias" (`/estrategias`, tela antiga): fica como última subaba até o dono decidir se sai (o CX disse que a Orquestração não aponta para ela).

## 3. SQL
Nenhum.

## 4. O que o CX precisa conferir no código (`/tmp/claude-0/site6/js`) antes do 79
1. **`abas-telas`, `Ve()`:** pode passar a agrupar por `rotulo` sem quebrar quem usa a mesma configuração? Por exemplo a gaveta do celular ou o ⌘K, que podem ler `Re` direto. E o 78 já tirou as abas "Relatórios" externas?
2. **Carteira:**
   - o seletor do cabeçalho (`Y()` do `X`/`N`) e as pílulas do cartão CARTEIRA chamam o mesmo `selectCredor` (`o`)?
   - dá para esconder o `Y()` só nesta tela (o `N` aceita uma opção para isso?), ou é preciso um cabeçalho próprio?
3. **Pausados (`Ot`):** como aparecem hoje (pílulas com "··"?) e se dá para pô-los num menu sem perder o "Pausado" por carteira.
4. **Cartão do segmento** (~l.10140–10380): depende de estado do editor (por exemplo "Tirar da carteira" recarregando o editor)? Movê-lo para um painel lateral mantém os mesmos handlers?
5. **"Ver todas as carteiras" (`Ie(!0)` → `Ks`) e "Reenquadrar agora" (`de` com `ref G`):** continuam funcionando se forem chamados de um item de menu (o `ref` do reenquadrar precisa estar montado na tela)?
6. **Faixas `sticky`:** a barra das vistas (~l.10414, `sticky top-0`) e a faixa interna do editor (~l.6480, `sticky top-0`) ficam por baixo da barra nova se não ganharem `top` igual à altura da faixa de contexto + barra. Qual a altura real da faixa de contexto do 75b?
7. **Número de clientes por segmento na pílula:** já vem de `segmentos_em_uso` (o print mostra "TESTE · 10.000")? Se não vier, a pílula fica só com o nome; nada de consulta nova.
8. **Cores:** quantos `#0F4C5C` há em `orquestracao` e `estrategia-editor-core` que são botões (para passar a contorno neutro) e quais são marcações do editor (célula ativa, raia), que não devem mudar.
9. **Permissões:** Planejamento e Admin editam; Operação e Gestão veem em leitura? A barra e a gaveta precisam respeitar a mesma regra (botões escondidos ou desabilitados como hoje).
